import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  decryptToken,
  encryptToken,
  loadOAuthTokens,
  revokeOAuthCredentials,
  saveOAuthCredentials,
} from '../src/worker/token-vault';
import {
  claimOutboundForDelivery,
  enqueueOutbound,
  markOutboundFailed,
  markOutboundSent,
} from '../src/worker/outbox';

function base64Key(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function keyring(active: 'v1' | 'v2' = 'v1') {
  return JSON.stringify({
    active,
    keys: {
      v1: base64Key(17),
      v2: base64Key(29),
    },
  });
}

async function insertConnection(id: string, externalId: string) {
  await env.DB.prepare(
    `INSERT INTO social_connections
      (id, workspace_id, platform, external_account_id, display_name, status)
     VALUES (?, 'default', 'instagram', ?, ?, 'connected')`,
  ).bind(id, externalId, `Compte ${id}`).run();
}

async function insertConversation(connectionId: string, contactId: string, conversationId: string) {
  const now = '2026-08-27T14:00:00.000Z';
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO contacts
        (id, workspace_id, external_id, platform, display_name, created_at, updated_at)
       VALUES (?, 'default', ?, 'instagram', ?, ?, ?)`,
    ).bind(contactId, `external-${contactId}`, `Contact ${contactId}`, now, now),
    env.DB.prepare(
      `INSERT INTO conversations
        (id, workspace_id, connection_id, contact_id, status, lead_stage, created_at, updated_at)
       VALUES (?, 'default', ?, ?, 'open', 'Nouveau', ?, ?)`,
    ).bind(conversationId, connectionId, contactId, now, now),
  ]);
}

describe('OAuth token vault', () => {
  it('encrypts tokens with tenant-bound AES-GCM additional data and supports key rotation', async () => {
    const context = {
      workspaceId: 'default',
      connectionId: 'connection-vault-context',
      provider: 'instagram' as const,
      kind: 'access' as const,
    };

    const encryptedV1 = await encryptToken(keyring('v1'), 'secret-access-token', context);
    expect(encryptedV1.keyVersion).toBe('v1');
    expect(encryptedV1.ciphertext).not.toContain('secret-access-token');
    await expect(decryptToken(keyring('v2'), encryptedV1, context)).resolves.toBe('secret-access-token');

    await expect(decryptToken(keyring('v2'), encryptedV1, {
      ...context,
      workspaceId: 'another-workspace',
    })).rejects.toThrow('OAuth token decryption failed');

    const encryptedV2 = await encryptToken(keyring('v2'), 'rotated-token', context);
    expect(encryptedV2.keyVersion).toBe('v2');
    await expect(decryptToken(keyring('v2'), encryptedV2, context)).resolves.toBe('rotated-token');
  });

  it('stores only ciphertext in D1, loads scoped credentials and revokes them', async () => {
    const connectionId = 'connection-vault-storage';
    await insertConnection(connectionId, 'ig-vault-storage');

    await saveOAuthCredentials(env.DB, keyring('v1'), {
      workspaceId: 'default',
      connectionId,
      provider: 'instagram',
      accessToken: 'access-token-must-never-be-plaintext-in-d1',
      refreshToken: 'refresh-token-must-never-be-plaintext-in-d1',
      scopes: ['messages', 'comments', 'messages'],
      accessExpiresAt: '2026-10-01T00:00:00.000Z',
    });

    const stored = await env.DB.prepare(
      `SELECT access_token_ciphertext, refresh_token_ciphertext, scopes_json, revoked_at
       FROM oauth_credentials WHERE connection_id = ?`,
    ).bind(connectionId).first<{
      access_token_ciphertext: string;
      refresh_token_ciphertext: string;
      scopes_json: string;
      revoked_at: string | null;
    }>();

    expect(stored).toBeTruthy();
    expect(stored?.access_token_ciphertext).not.toContain('access-token-must-never-be-plaintext-in-d1');
    expect(stored?.refresh_token_ciphertext).not.toContain('refresh-token-must-never-be-plaintext-in-d1');
    expect(JSON.parse(stored?.scopes_json ?? '[]')).toEqual(['comments', 'messages']);
    expect(stored?.revoked_at).toBeNull();

    const loaded = await loadOAuthTokens(env.DB, keyring('v2'), 'default', connectionId);
    expect(loaded).toMatchObject({
      accessToken: 'access-token-must-never-be-plaintext-in-d1',
      refreshToken: 'refresh-token-must-never-be-plaintext-in-d1',
      credentials: {
        workspaceId: 'default',
        connectionId,
        provider: 'instagram',
        scopes: ['comments', 'messages'],
      },
    });

    await expect(revokeOAuthCredentials(env.DB, 'default', connectionId)).resolves.toBe(true);
    await expect(loadOAuthTokens(env.DB, keyring('v2'), 'default', connectionId)).resolves.toBeUndefined();
  });
});

describe('outbound transactional boundary', () => {
  it('deduplicates the same request and rejects idempotency-key reuse with another payload', async () => {
    const connectionId = 'connection-outbox-idempotency';
    const conversationId = 'conversation-outbox-idempotency';
    await insertConnection(connectionId, 'ig-outbox-idempotency');
    await insertConversation(connectionId, 'contact-outbox-idempotency', conversationId);

    const first = await enqueueOutbound(env.DB, {
      workspaceId: 'default',
      conversationId,
      idempotencyKey: 'idem-message-0001',
      body: 'Bonjour depuis Neptune',
      actorId: 'actor-1',
    });
    expect(first).toMatchObject({ status: 'pending', replayed: false, attemptCount: 0 });

    const replay = await enqueueOutbound(env.DB, {
      workspaceId: 'default',
      conversationId,
      idempotencyKey: 'idem-message-0001',
      body: 'Bonjour depuis Neptune',
      actorId: 'actor-1',
    });
    expect(replay.id).toBe(first.id);
    expect(replay.replayed).toBe(true);

    await expect(enqueueOutbound(env.DB, {
      workspaceId: 'default',
      conversationId,
      idempotencyKey: 'idem-message-0001',
      body: 'Un autre message sous la même clé',
      actorId: 'actor-1',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM outbound_messages WHERE workspace_id = ? AND idempotency_key = ?',
    ).bind('default', 'idem-message-0001').first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it('allows exactly one delivery claim and records sent/failed transitions', async () => {
    const connectionId = 'connection-outbox-state';
    const conversationId = 'conversation-outbox-state';
    await insertConnection(connectionId, 'ig-outbox-state');
    await insertConversation(connectionId, 'contact-outbox-state', conversationId);

    const queued = await enqueueOutbound(env.DB, {
      workspaceId: 'default',
      conversationId,
      idempotencyKey: 'idem-message-0002',
      body: 'Message à envoyer une seule fois',
      actorId: 'actor-2',
    });

    await expect(claimOutboundForDelivery(env.DB, queued.id, 'default')).resolves.toBe(true);
    await expect(claimOutboundForDelivery(env.DB, queued.id, 'default')).resolves.toBe(false);
    await expect(markOutboundSent(env.DB, {
      id: queued.id,
      workspaceId: 'default',
      providerMessageId: 'provider-message-42',
    })).resolves.toBe(true);

    const sent = await env.DB.prepare(
      `SELECT status, attempt_count, provider_message_id, sent_at
       FROM outbound_messages WHERE id = ?`,
    ).bind(queued.id).first<{
      status: string;
      attempt_count: number;
      provider_message_id: string;
      sent_at: string;
    }>();
    expect(sent).toMatchObject({ status: 'sent', attempt_count: 1, provider_message_id: 'provider-message-42' });
    expect(sent?.sent_at).toBeTruthy();

    const failedQueued = await enqueueOutbound(env.DB, {
      workspaceId: 'default',
      conversationId,
      idempotencyKey: 'idem-message-0003',
      body: 'Message qui échouera au premier essai',
      actorId: 'actor-2',
    });
    await expect(claimOutboundForDelivery(env.DB, failedQueued.id, 'default')).resolves.toBe(true);
    await expect(markOutboundFailed(env.DB, {
      id: failedQueued.id,
      workspaceId: 'default',
      errorCode: 'PROVIDER_RATE_LIMITED',
      retryAt: '2099-01-01T00:00:00.000Z',
    })).resolves.toBe(true);
    await expect(claimOutboundForDelivery(env.DB, failedQueued.id, 'default')).resolves.toBe(false);
  });
});
