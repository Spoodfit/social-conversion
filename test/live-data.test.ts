import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { WorkspacePrincipal, WorkspaceRole } from '../src/worker/authorization';
import { createApp } from '../src/worker/index';
import {
  LiveDataError,
  listConversationMessages,
  listInboxConversations,
  updateConversationCrm,
} from '../src/worker/live-data';

const workspaceId = 'live-data-test';
const otherWorkspaceId = 'live-data-other';

async function ensureWorkspace(id: string, name: string): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)').bind(id, name).run();
}

async function insertMember(subject: string, role: WorkspaceRole, targetWorkspaceId = workspaceId): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace_members
      (id, workspace_id, access_subject, email, role, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
  ).bind(`member:${targetWorkspaceId}:${subject}`, targetWorkspaceId, subject, `${subject}@example.test`, role).run();
}

async function insertConversationFixture(input: {
  id: string;
  targetWorkspaceId?: string;
  platform?: 'instagram' | 'youtube' | 'tiktok';
  stage?: string;
  updatedAt: string;
  lastMessageAt?: string;
  messages?: Array<{ id: string; sentAt: string; body: string; direction?: 'inbound' | 'outbound' }>;
}) {
  const targetWorkspaceId = input.targetWorkspaceId ?? workspaceId;
  const platform = input.platform ?? 'instagram';
  const connectionId = `connection:${input.id}`;
  const contactId = `contact:${input.id}`;
  const externalAccountId = `external-account:${input.id}`;
  const externalContactId = `external-contact:${input.id}`;
  const now = input.updatedAt;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO social_connections
        (id, workspace_id, platform, external_account_id, display_name, status, updated_at)
       VALUES (?, ?, ?, ?, ?, 'connected', ?)`,
    ).bind(connectionId, targetWorkspaceId, platform, externalAccountId, `Compte ${input.id}`, now),
    env.DB.prepare(
      `INSERT INTO contacts
        (id, workspace_id, external_id, platform, display_name, handle, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(contactId, targetWorkspaceId, externalContactId, platform, `Contact ${input.id}`, `@${input.id}`, now, now),
    env.DB.prepare(
      `INSERT INTO conversations
        (id, workspace_id, connection_id, contact_id, status, priority, lead_stage,
         estimated_value_cents, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', 'normal', ?, 1000, ?, ?, ?)`,
    ).bind(
      input.id,
      targetWorkspaceId,
      connectionId,
      contactId,
      input.stage ?? 'Nouveau',
      input.lastMessageAt ?? null,
      now,
      now,
    ),
  ]);

  for (const message of input.messages ?? []) {
    await env.DB.prepare(
      `INSERT INTO messages
        (id, conversation_id, external_id, direction, message_type, body, status, ai_assisted, sent_at, created_at)
       VALUES (?, ?, ?, ?, 'message', ?, 'received', 0, ?, ?)`,
    ).bind(
      message.id,
      input.id,
      `external:${message.id}`,
      message.direction ?? 'inbound',
      message.body,
      message.sentAt,
      message.sentAt,
    ).run();
  }
}

function principal(subject: string, role: WorkspaceRole = 'agent'): WorkspacePrincipal {
  return {
    subject,
    email: `${subject}@example.test`,
    workspaceId,
    workspaceName: 'Live Data Test',
    role,
    memberId: `member:${workspaceId}:${subject}`,
  };
}

function liveEnv(): Env {
  return {
    ...env,
    DEMO_MODE: 'false',
    LIVE_READY: 'true',
  } as unknown as Env;
}

async function fetchLive(subject: string, path: string, init?: RequestInit): Promise<Response> {
  const app = createApp({ verifyAccessToken: async () => ({ subject, email: `${subject}@example.test` }) });
  const headers = new Headers(init?.headers);
  headers.set('cf-access-jwt-assertion', 'verified-by-test-double');
  headers.set('x-workspace-id', workspaceId);
  const request = new Request(`https://example.test${path}`, { ...init, headers });
  return app.fetch(request, liveEnv(), createExecutionContext());
}

describe('live inbox pagination', () => {
  it('paginates deterministically and never leaks another workspace', async () => {
    await ensureWorkspace(workspaceId, 'Live Data Test');
    await ensureWorkspace(otherWorkspaceId, 'Other Tenant');

    await insertConversationFixture({
      id: 'inbox-conv-03',
      updatedAt: '2026-08-27T14:03:00.000Z',
      lastMessageAt: '2026-08-27T14:03:00.000Z',
      messages: [{ id: 'inbox-message-03', sentAt: '2026-08-27T14:03:00.000Z', body: 'Troisième minute' }],
    });
    await insertConversationFixture({
      id: 'inbox-conv-02',
      updatedAt: '2026-08-27T14:02:00.000Z',
      lastMessageAt: '2026-08-27T14:02:00.000Z',
      stage: 'Qualifié',
      messages: [{ id: 'inbox-message-02', sentAt: '2026-08-27T14:02:00.000Z', body: 'Deuxième minute' }],
    });
    await insertConversationFixture({
      id: 'inbox-conv-01',
      updatedAt: '2026-08-27T14:01:00.000Z',
      lastMessageAt: '2026-08-27T14:01:00.000Z',
      platform: 'youtube',
      messages: [{ id: 'inbox-message-01', sentAt: '2026-08-27T14:01:00.000Z', body: 'Première minute' }],
    });
    await insertConversationFixture({
      id: 'inbox-other-tenant',
      targetWorkspaceId: otherWorkspaceId,
      updatedAt: '2026-08-27T15:00:00.000Z',
      lastMessageAt: '2026-08-27T15:00:00.000Z',
      messages: [{ id: 'inbox-other-message', sentAt: '2026-08-27T15:00:00.000Z', body: 'Secret autre tenant' }],
    });

    const first = await listInboxConversations(env.DB, workspaceId, { limit: '2' });
    expect(first.conversations.map((conversation) => conversation.id)).toEqual(['inbox-conv-03', 'inbox-conv-02']);
    expect(first.conversations[0]?.latestMessage?.body).toBe('Troisième minute');
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toBeTruthy();

    const second = await listInboxConversations(env.DB, workspaceId, {
      limit: '2',
      cursor: first.page.nextCursor,
    });
    expect(second.conversations.map((conversation) => conversation.id)).toEqual(['inbox-conv-01']);
    expect(second.page.hasMore).toBe(false);
    expect(JSON.stringify([...first.conversations, ...second.conversations])).not.toContain('Secret autre tenant');

    const filtered = await listInboxConversations(env.DB, workspaceId, { platform: 'youtube' });
    expect(filtered.conversations.map((conversation) => conversation.id)).toContain('inbox-conv-01');
    expect(filtered.conversations.every((conversation) => conversation.platform === 'youtube')).toBe(true);
  });

  it('rejects malformed cursors and invalid filters', async () => {
    await expect(listInboxConversations(env.DB, workspaceId, { cursor: '../../etc/passwd' }))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(listInboxConversations(env.DB, workspaceId, { platform: 'facebook' }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(listInboxConversations(env.DB, workspaceId, { limit: '999' }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('paginates messages inside the tenant-scoped conversation', async () => {
    const pageOne = await listConversationMessages(env.DB, workspaceId, 'inbox-conv-03', { limit: '1' });
    expect(pageOne.messages).toHaveLength(1);
    expect(pageOne.messages[0]?.body).toBe('Troisième minute');

    await expect(listConversationMessages(env.DB, workspaceId, 'inbox-other-tenant'))
      .rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });
});

describe('persistent CRM mutation', () => {
  it('updates with optimistic concurrency, writes an audit and rejects stale overwrites', async () => {
    const subject = 'crm-agent-live-data';
    await ensureWorkspace(workspaceId, 'Live Data Test');
    await insertConversationFixture({
      id: 'crm-conversation-01',
      updatedAt: '2026-08-27T13:00:00.000Z',
    });

    const updated = await updateConversationCrm(env.DB, principal(subject), 'crm-conversation-01', {
      expectedUpdatedAt: '2026-08-27T13:00:00.000Z',
      leadStage: 'Qualifié',
      estimatedValueCents: 250000,
      priority: 'high',
      assignedTo: 'member-commercial-1',
    });
    expect(updated).toMatchObject({
      id: 'crm-conversation-01',
      lead_stage: 'Qualifié',
      estimated_value_cents: 250000,
      priority: 'high',
      assigned_to: 'member-commercial-1',
    });
    expect(updated.updated_at).not.toBe('2026-08-27T13:00:00.000Z');

    const audit = await env.DB.prepare(
      `SELECT action, resource_id, metadata_json
       FROM audit_logs WHERE workspace_id = ? AND actor_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(workspaceId, subject).first<{ action: string; resource_id: string; metadata_json: string }>();
    expect(audit).toMatchObject({ action: 'crm.conversation_updated', resource_id: 'crm-conversation-01' });
    expect(JSON.parse(audit?.metadata_json ?? '{}')).toMatchObject({ changedFieldCount: 4 });

    await expect(updateConversationCrm(env.DB, principal(subject), 'crm-conversation-01', {
      expectedUpdatedAt: '2026-08-27T13:00:00.000Z',
      leadStage: 'Gagné',
    })).rejects.toMatchObject({ code: 'CONVERSATION_CONFLICT' });

    const afterConflict = await env.DB.prepare(
      'SELECT lead_stage FROM conversations WHERE id = ? AND workspace_id = ?',
    ).bind('crm-conversation-01', workspaceId).first<{ lead_stage: string }>();
    expect(afterConflict?.lead_stage).toBe('Qualifié');
  });

  it('validates mutation fields before touching D1', async () => {
    await expect(updateConversationCrm(env.DB, principal('crm-invalid'), 'crm-conversation-01', {
      expectedUpdatedAt: '2026-08-27T13:00:00.000Z',
      leadStage: 'Nimporte quoi',
    })).rejects.toBeInstanceOf(LiveDataError);
  });

  it('enforces viewer read-only and maps stale route updates to HTTP 409', async () => {
    const viewer = 'crm-viewer-route';
    const agent = 'crm-agent-route';
    await ensureWorkspace(workspaceId, 'Live Data Test');
    await insertMember(viewer, 'viewer');
    await insertMember(agent, 'agent');
    await insertConversationFixture({
      id: 'crm-route-conversation',
      updatedAt: '2026-08-27T12:00:00.000Z',
    });

    const viewerResponse = await fetchLive(viewer, '/api/crm/conversations/crm-route-conversation', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: '2026-08-27T12:00:00.000Z',
        leadStage: 'Qualifié',
      }),
    });
    expect(viewerResponse.status).toBe(403);
    await expect(viewerResponse.json()).resolves.toMatchObject({ code: 'ROLE_FORBIDDEN' });

    const first = await fetchLive(agent, '/api/crm/conversations/crm-route-conversation', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: '2026-08-27T12:00:00.000Z',
        leadStage: 'Qualifié',
      }),
    });
    expect(first.status).toBe(200);

    const stale = await fetchLive(agent, '/api/crm/conversations/crm-route-conversation', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: '2026-08-27T12:00:00.000Z',
        leadStage: 'Gagné',
      }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: 'CONVERSATION_CONFLICT' });

    const inbox = await fetchLive(agent, '/api/inbox/conversations?limit=2');
    expect(inbox.status).toBe(200);
    await expect(inbox.json()).resolves.toHaveProperty('page.limit', 2);
  });
});
