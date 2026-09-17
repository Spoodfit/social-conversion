import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/worker/index';

const workspaceId = 'automation-route-test';

async function seed(subject: string, role: 'agent' | 'viewer', connectionId: string) {
  await env.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)')
    .bind(workspaceId, 'Automation Route Test').run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace_members
      (id, workspace_id, access_subject, email, role, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
  ).bind(`member:${subject}`, workspaceId, subject, `${subject}@example.test`, role).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO social_connections
      (id, workspace_id, platform, external_account_id, display_name, status, capabilities_json)
     VALUES (?, ?, 'instagram', ?, ?, 'connected', ?)`,
  ).bind(connectionId, workspaceId, `external:${connectionId}`, `Compte ${connectionId}`, JSON.stringify({ comments: true, direct_messages: true })).run();
}

function liveEnv(): Env {
  return { ...env, DEMO_MODE: 'false', LIVE_READY: 'true' } as unknown as Env;
}

async function request(subject: string, path: string, init: RequestInit = {}) {
  const app = createApp({ verifyAccessToken: async () => ({ subject, email: `${subject}@example.test` }) });
  const headers = new Headers(init.headers);
  headers.set('cf-access-jwt-assertion', 'verified-by-test-double');
  headers.set('x-workspace-id', workspaceId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.fetch(new Request(`https://example.test${path}`, { ...init, headers }), liveEnv(), createExecutionContext());
}

describe('automation API', () => {
  it('creates and lists a real draft but refuses activation', async () => {
    const subject = 'automation-route-agent';
    const connectionId = 'automation-route-connection';
    await seed(subject, 'agent', connectionId);

    const createResponse = await request(subject, '/api/automations', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Route commentaire',
        connectionId,
        platform: 'instagram',
        triggerType: 'comment',
        triggerConfig: { contains: ['info'] },
        actionConfig: { type: 'move_stage', stage: 'Qualifié' },
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { automation: { id: string; version: number; active: boolean; executionReady: boolean } };
    expect(created.automation).toMatchObject({ version: 1, active: false, executionReady: false });

    const listResponse = await request(subject, `/api/automations?connectionId=${encodeURIComponent(connectionId)}`);
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as { automations: Array<{ id: string }>; executionReady: boolean };
    expect(listed.executionReady).toBe(false);
    expect(listed.automations.map((rule) => rule.id)).toContain(created.automation.id);

    const activateResponse = await request(subject, `/api/automations/${created.automation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: 1, active: true }),
    });
    expect(activateResponse.status).toBe(409);
    await expect(activateResponse.json()).resolves.toMatchObject({ code: 'AUTOMATION_EXECUTION_NOT_READY' });
  });

  it('enforces viewer read-only and optimistic update conflicts', async () => {
    const agent = 'automation-route-conflict-agent';
    const viewer = 'automation-route-viewer';
    const connectionId = 'automation-route-conflict-connection';
    await seed(agent, 'agent', connectionId);
    await seed(viewer, 'viewer', connectionId);

    const createdResponse = await request(agent, '/api/automations', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Versionnée',
        connectionId,
        platform: 'instagram',
        triggerType: 'incoming_message',
        triggerConfig: {},
        actionConfig: { type: 'set_priority', priority: 'high' },
      }),
    });
    const created = await createdResponse.json() as { automation: { id: string; version: number } };

    const viewerPatch = await request(viewer, `/api/automations/${created.automation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: 1, name: 'Interdit' }),
    });
    expect(viewerPatch.status).toBe(403);
    await expect(viewerPatch.json()).resolves.toMatchObject({ code: 'ROLE_FORBIDDEN' });

    const update = await request(agent, `/api/automations/${created.automation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: 1, name: 'Version 2' }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toHaveProperty('automation.version', 2);

    const stale = await request(agent, `/api/automations/${created.automation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: 1, name: 'Écrasement' }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: 'AUTOMATION_CONFLICT' });
  });
});
