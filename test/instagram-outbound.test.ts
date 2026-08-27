import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { deliverInstagramOutbound } from '../src/worker/instagram-outbound';
import { claimOutboundForDelivery, enqueueOutbound } from '../src/worker/outbox';
import { saveOAuthCredentials } from '../src/worker/token-vault';

function base64Key(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function keyring() {
  return JSON.stringify({ active: 'v1', keys: { v1: base64Key(41) } });
}

function outboundEnv(): Env {
  return {
    ...env,
    META_GRAPH_VERSION: 'v24.0',
    TOKEN_ENCRYPTION_KEYRING: keyring(),
  } as unknown as Env;
}

async function seed(id: string, withInbound = true) {
  const connectionId = `ig-outbound:${id}`;
  const contactId = `ig-contact:${id}`;
  const conversationId = `ig-conversation:${id}`;
  const now = '2026-08-27T15:00:00.000Z';
  await env.DB.prepare(
    `INSERT INTO social_connections
      (id, workspace_id, platform, external_account_id, display_name, status, capabilities_json)
     VALUES (?, 'default', 'instagram', ?, ?, 'connected', ?)`,
  ).bind(connectionId, `1789000${id.replace(/\D/g, '').padEnd(4, '0')}`, `Instagram ${id}`, JSON.stringify({ direct_messages: true })).run();
  await env.DB.prepare(
    `INSERT INTO contacts
      (id, workspace_id, external_id, platform, display_name, created_at, updated_at)
     VALUES (?, 'default', ?, 'instagram', ?, ?, ?)`,
  ).bind(contactId, `998800${id.replace(/\D/g, '').padEnd(4, '0')}`, `Prospect ${id}`, now, now).run();
  await env.DB.prepare(
    `INSERT INTO conversations
      (id, workspace_id, connection_id, contact_id, status, lead_stage, created_at, updated_at, last_message_at)
     VALUES (?, 'default', ?, ?, 'open', 'Nouveau', ?, ?, ?)`,
  ).bind(conversationId, connectionId, contactId, now, now, now).run();
  if (withInbound) {
    await env.DB.prepare(
      `INSERT INTO messages
        (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at)
       VALUES (?, ?, ?, 'inbound', 'message', 'Bonjour', 'received', ?, ?)`,
    ).bind(`inbound:${id}`, conversationId, `external-inbound:${id}`, now, now).run();
  }
  await saveOAuthCredentials(env.DB, keyring(), {
    workspaceId: 'default',
    connectionId,
    provider: 'instagram',
    accessToken: `IGAA-secret-${id}`,
    scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
    accessExpiresAt: '2026-10-20T00:00:00.000Z',
  });
  const outbox = await enqueueOutbound(env.DB, {
    workspaceId: 'default',
    conversationId,
    idempotencyKey: `instagram-send-${id}-0001`,
    body: `Réponse Neptune ${id}`,
    actorId: 'outbound-agent',
  });
  expect(await claimOutboundForDelivery(env.DB, outbox.id, 'default')).toBe(true);
  return { connectionId, conversationId, outbox };
}

describe('Instagram outbound provider', () => {
  it('sends only to the inbound IGSID and persists the provider message into history', async () => {
    const seeded = await seed('101');
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toMatch(/^https:\/\/graph\.instagram\.com\/v24\.0\/17890001010\/messages$/);
      expect((init?.headers as Record<string, string>)?.authorization).toBe('Bearer IGAA-secret-101');
      const body = JSON.parse(String(init?.body)) as { recipient: { id: string }; message: { text: string } };
      expect(body.recipient.id).toBe('9988001010');
      expect(body.message.text).toBe('Réponse Neptune 101');
      return Response.json({ recipient_id: body.recipient.id, message_id: 'mid.instagram.101' });
    });

    await expect(deliverInstagramOutbound(env.DB, outboundEnv(), {
      kind: 'outbound_delivery', id: seeded.outbox.id, workspaceId: 'default',
    }, fetchMock)).resolves.toBe('sent');

    const row = await env.DB.prepare(
      `SELECT status, provider_message_id, attempt_count FROM outbound_messages WHERE id = ?`,
    ).bind(seeded.outbox.id).first<{ status: string; provider_message_id: string; attempt_count: number }>();
    expect(row).toMatchObject({ status: 'sent', provider_message_id: 'mid.instagram.101', attempt_count: 1 });

    const history = await env.DB.prepare(
      `SELECT direction, body, status, external_id FROM messages
       WHERE conversation_id = ? AND direction = 'outbound'`,
    ).bind(seeded.conversationId).first<{ direction: string; body: string; status: string; external_id: string }>();
    expect(history).toMatchObject({
      direction: 'outbound', body: 'Réponse Neptune 101', status: 'sent', external_id: 'mid.instagram.101',
    });
  });

  it('blocks cold outbound when no inbound message exists', async () => {
    const seeded = await seed('102', false);
    const fetchMock = vi.fn<typeof fetch>();
    await expect(deliverInstagramOutbound(env.DB, outboundEnv(), {
      kind: 'outbound_delivery', id: seeded.outbox.id, workspaceId: 'default',
    }, fetchMock)).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await env.DB.prepare(
      'SELECT status, last_error_code, next_attempt_at FROM outbound_messages WHERE id = ?',
    ).bind(seeded.outbox.id).first<{ status: string; last_error_code: string; next_attempt_at: string | null }>();
    expect(row).toMatchObject({ status: 'failed', last_error_code: 'CONVERSATION_NOT_INITIATED', next_attempt_at: null });
  });

  it('retries explicit rate limits but never auto-retries an ambiguous network outcome', async () => {
    const limited = await seed('103');
    const rateLimitedFetch = vi.fn<typeof fetch>(async () => new Response('{}', {
      status: 429,
      headers: { 'retry-after': '90', 'content-type': 'application/json' },
    }));
    await deliverInstagramOutbound(env.DB, outboundEnv(), {
      kind: 'outbound_delivery', id: limited.outbox.id, workspaceId: 'default',
    }, rateLimitedFetch);
    const limitedRow = await env.DB.prepare(
      'SELECT last_error_code, next_attempt_at FROM outbound_messages WHERE id = ?',
    ).bind(limited.outbox.id).first<{ last_error_code: string; next_attempt_at: string | null }>();
    expect(limitedRow?.last_error_code).toBe('META_RATE_LIMITED');
    expect(limitedRow?.next_attempt_at).toBeTruthy();

    const ambiguous = await seed('104');
    const ambiguousFetch = vi.fn<typeof fetch>(async () => { throw new Error('socket reset'); });
    await deliverInstagramOutbound(env.DB, outboundEnv(), {
      kind: 'outbound_delivery', id: ambiguous.outbox.id, workspaceId: 'default',
    }, ambiguousFetch);
    const ambiguousRow = await env.DB.prepare(
      'SELECT last_error_code, next_attempt_at FROM outbound_messages WHERE id = ?',
    ).bind(ambiguous.outbox.id).first<{ last_error_code: string; next_attempt_at: string | null }>();
    expect(ambiguousRow).toMatchObject({ last_error_code: 'META_OUTCOME_UNKNOWN', next_attempt_at: null });
  });

  it('fails closed when the required permission is absent', async () => {
    const seeded = await seed('105');
    await env.DB.prepare(
      `UPDATE oauth_credentials SET scopes_json = '["instagram_business_basic"]' WHERE connection_id = ?`,
    ).bind(seeded.connectionId).run();
    const fetchMock = vi.fn<typeof fetch>();
    await deliverInstagramOutbound(env.DB, outboundEnv(), {
      kind: 'outbound_delivery', id: seeded.outbox.id, workspaceId: 'default',
    }, fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await env.DB.prepare(
      'SELECT last_error_code FROM outbound_messages WHERE id = ?',
    ).bind(seeded.outbox.id).first<{ last_error_code: string }>();
    expect(row?.last_error_code).toBe('OAUTH_SCOPE_MISSING');
  });
});
