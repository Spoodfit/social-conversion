import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/worker/index';

function appFor(subject: string, email = `${subject}@example.test`) {
  return createApp({ verifyAccessToken: async () => ({ subject, email }) });
}

async function request(
  subject: string,
  path: string,
  options: { workspaceId?: string; live?: boolean } = {},
): Promise<Response> {
  const headers = new Headers({ 'cf-access-jwt-assertion': 'verified-by-test-double' });
  if (options.workspaceId) headers.set('x-workspace-id', options.workspaceId);
  const runtimeEnv = options.live
    ? Object.assign(Object.create(env), { DEMO_MODE: 'false', LIVE_READY: 'true' }) as Env
    : env;
  return appFor(subject).fetch(
    new Request(`https://example.test${path}`, { headers }),
    runtimeEnv,
    createExecutionContext(),
  );
}

async function addWorkspaceMembership(subject: string, workspaceId: string, workspaceName: string) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').bind(workspaceId, workspaceName),
    env.DB.prepare(
      `INSERT INTO workspace_members
        (id, workspace_id, access_subject, email, role, status)
       VALUES (?, ?, ?, ?, 'manager', 'active')`,
    ).bind(`member:${subject}:${workspaceId}`, workspaceId, subject, `${subject}@example.test`),
  ]);
}

describe('live runtime workspace boundary', () => {
  it('lists authorized workspaces before one is selected', async () => {
    const subject = 'multi-workspace-user';
    await addWorkspaceMembership(subject, 'workspace-a', 'Agence A');
    await addWorkspaceMembership(subject, 'workspace-b', 'Agence B');

    const workspaceResponse = await request(subject, '/api/workspaces');
    expect(workspaceResponse.status).toBe(200);
    await expect(workspaceResponse.json()).resolves.toMatchObject({
      workspaces: [
        { id: 'workspace-a', name: 'Agence A', role: 'manager' },
        { id: 'workspace-b', name: 'Agence B', role: 'manager' },
      ],
    });

    const sessionWithoutSelection = await request(subject, '/api/session');
    expect(sessionWithoutSelection.status).toBe(400);
    await expect(sessionWithoutSelection.json()).resolves.toMatchObject({ code: 'WORKSPACE_REQUIRED' });
  });

  it('returns only real D1 data in live bootstrap', async () => {
    const subject = 'live-bootstrap-user';
    await env.DB.prepare(
      `INSERT INTO workspace_members
        (id, workspace_id, access_subject, email, role, status)
       VALUES (?, 'default', ?, ?, 'admin', 'active')`,
    ).bind(`member:${subject}`, subject, `${subject}@example.test`).run();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO social_connections
          (id, workspace_id, platform, external_account_id, display_name, handle, status)
         VALUES ('live-connection', 'default', 'instagram', 'ig-live', 'Instagram Neptune', '@neptune', 'connected')`,
      ),
      env.DB.prepare(
        `INSERT INTO contacts
          (id, workspace_id, external_id, platform, display_name, handle, created_at, updated_at)
         VALUES ('live-contact', 'default', 'contact-live', 'instagram', 'Client réel', '@client', ?, ?)`,
      ).bind('2026-08-27T12:00:00.000Z', '2026-08-27T12:00:00.000Z'),
      env.DB.prepare(
        `INSERT INTO conversations
          (id, workspace_id, connection_id, contact_id, status, priority, lead_stage, estimated_value_cents, last_message_at, created_at, updated_at)
         VALUES ('live-conversation', 'default', 'live-connection', 'live-contact', 'open', 'high', 'Qualifié', 125000, ?, ?, ?)`,
      ).bind('2026-08-27T12:01:00.000Z', '2026-08-27T12:00:00.000Z', '2026-08-27T12:01:00.000Z'),
    ]);

    const response = await request(subject, '/api/bootstrap', { workspaceId: 'default', live: true });
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      metrics: { contacts: number; openConversations: number; connectedAccounts: number; estimatedPipelineCents: number };
      connections: Array<{ id: string; displayName: string }>;
      recentConversations: Array<{ id: string; contactName: string }>;
    };

    expect(payload.metrics).toMatchObject({
      contacts: 1,
      openConversations: 1,
      connectedAccounts: 1,
      estimatedPipelineCents: 125000,
    });
    expect(payload.connections).toContainEqual(expect.objectContaining({ id: 'live-connection', displayName: 'Instagram Neptune' }));
    expect(payload.recentConversations).toContainEqual(expect.objectContaining({ id: 'live-conversation', contactName: 'Client réel' }));
    expect(JSON.stringify(payload)).not.toContain('Bonjour, Neptune');
  });
});
