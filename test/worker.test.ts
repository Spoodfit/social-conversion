import { env } from 'cloudflare:workers';
import { SELF, createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { normalizeMetaWebhook } from '../src/shared/events';
import { createApp } from '../src/worker/index';
import type { WorkspaceRole } from '../src/worker/authorization';

const encoder = new TextEncoder();

async function metaSignature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function insertMember(
  subject: string,
  role: WorkspaceRole,
  status: 'invited' | 'active' = 'active',
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO workspace_members
        (id, workspace_id, access_subject, email, role, status)
       VALUES (?, 'default', ?, ?, ?, ?)`,
    )
    .bind(
      `member:${subject}`,
      status === 'active' ? subject : null,
      `${subject}@example.test`,
      role,
      status,
    )
    .run();
}

function appFor(subject: string, email = `${subject}@example.test`) {
  return createApp({
    verifyAccessToken: async () => ({ subject, email }),
  });
}

async function fetchApp(subject: string, path: string, init?: RequestInit): Promise<Response> {
  const app = appFor(subject);
  const headers = new Headers(init?.headers);
  headers.set('cf-access-jwt-assertion', 'verified-by-test-double');
  const request = new Request(`https://example.test${path}`, {
    ...init,
    headers,
  });
  return app.fetch(request, env, createExecutionContext());
}

describe('worker security boundary', () => {
  it('exposes only a minimal public health endpoint', async () => {
    const publicResponse = await SELF.fetch('https://example.test/health');
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toMatchObject({
      status: 'ok',
      service: 'neptune-social-conversion',
    });

    const protectedResponse = await SELF.fetch('https://example.test/api/health');
    expect(protectedResponse.status).toBe(401);
    await expect(protectedResponse.json()).resolves.toMatchObject({ code: 'ACCESS_TOKEN_MISSING' });
  });

  it('activates an email invitation and returns the scoped session', async () => {
    const subject = 'invited-user';
    await insertMember(subject, 'agent', 'invited');

    const response = await fetchApp(subject, '/api/session');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      subject,
      workspace: { id: 'default', role: 'agent' },
    });

    const membership = await env.DB
      .prepare('SELECT access_subject, status FROM workspace_members WHERE id = ?')
      .bind(`member:${subject}`)
      .first<{ access_subject: string; status: string }>();
    expect(membership).toEqual({ access_subject: subject, status: 'active' });
  });

  it('exposes an authenticated demo runtime state', async () => {
    const subject = 'runtime-agent';
    await insertMember(subject, 'agent');
    const response = await fetchApp(subject, '/api/runtime');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: 'demo',
      ready: true,
      outboundReady: false,
      aiReady: false,
    });
  });

  it('audits a simulated outbound message without storing its body in the audit log', async () => {
    const subject = 'message-agent';
    await insertMember(subject, 'agent');
    const response = await fetchApp(subject, '/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-demo', message: 'Bonjour' }),
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: 'simulated' });

    const audit = await env.DB
      .prepare(
        `SELECT action, workspace_id, actor_id, metadata_json
         FROM audit_logs WHERE actor_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(subject)
      .first<{ action: string; workspace_id: string; actor_id: string; metadata_json: string }>();
    expect(audit).toMatchObject({
      action: 'message.simulated',
      workspace_id: 'default',
      actor_id: subject,
    });
    expect(JSON.parse(audit?.metadata_json ?? '{}')).toEqual({ messageLength: 7 });
  });

  it('blocks mutations for viewer roles', async () => {
    const subject = 'readonly-viewer';
    await insertMember(subject, 'viewer');
    const response = await fetchApp(subject, '/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-demo', message: 'Bonjour' }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'ROLE_FORBIDDEN' });
  });

  it('rejects a workspace selected outside the authenticated membership', async () => {
    const subject = 'scoped-agent';
    await insertMember(subject, 'agent');
    const response = await fetchApp(subject, '/api/session', {
      headers: { 'x-workspace-id': 'another-workspace' },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
  });
});

describe('Meta normalization', () => {
  it('maps a Meta direct message from the recipient account, not caller input', () => {
    const events = normalizeMetaWebhook(
      {
        entry: [{
          id: 'ig-business-42',
          messaging: [{
            sender: { id: '42' },
            timestamp: 1_722_000_000_000,
            message: { mid: 'm-1', text: 'Bonjour' },
          }],
        }],
      },
      new Map([['ig-business-42', { id: 'connection-1', workspaceId: 'default' }]]),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'connection-1:m-1',
      externalEventId: 'm-1',
      workspaceId: 'default',
      connectionId: 'connection-1',
      platform: 'instagram',
      eventType: 'message',
      text: 'Bonjour',
    });
  });

  it('drops events for unknown recipient accounts', () => {
    const events = normalizeMetaWebhook({
      entry: [{
        id: 'unknown-account',
        messaging: [{
          sender: { id: '42' },
          message: { mid: 'm-1', text: 'Bonjour' },
        }],
      }],
    }, new Map());
    expect(events).toEqual([]);
  });

  it('resolves the webhook tenant from D1 even when a caller injects a connection query', async () => {
    await env.DB
      .prepare(
        `INSERT INTO social_connections
          (id, workspace_id, platform, external_account_id, display_name, status)
         VALUES ('connection-db', 'default', 'instagram', 'ig-business-db', 'Compte pilote', 'connected')`,
      )
      .run();

    const body = JSON.stringify({
      entry: [{
        id: 'ig-business-db',
        messaging: [{
          sender: { id: 'contact-db' },
          timestamp: 1_722_000_000_000,
          message: { mid: 'message-db', text: 'Bonjour' },
        }],
      }],
    });
    const response = await SELF.fetch('https://example.test/webhooks/meta?connection=attacker-choice', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': await metaSignature(body, 'test-meta-secret'),
      },
      body,
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: 1 });
  });

  it('rejects an oversized webhook before buffering or signature work', async () => {
    const response = await SELF.fetch('https://example.test/webhooks/meta', {
      method: 'POST',
      headers: { 'content-length': '1000001' },
      body: '{}',
    });
    expect(response.status).toBe(413);
  });
});
