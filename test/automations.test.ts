import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { WorkspacePrincipal } from '../src/worker/authorization';
import {
  archiveAutomationDraft,
  createAutomationDraft,
  listAutomationDrafts,
  updateAutomationDraft,
} from '../src/worker/automations';

const workspaceId = 'automation-test';
const otherWorkspaceId = 'automation-other';

async function ensureWorkspace(id: string, name: string) {
  await env.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)').bind(id, name).run();
}

async function insertConnection(input: {
  id: string;
  workspaceId?: string;
  platform?: 'instagram' | 'youtube' | 'tiktok';
  capabilities?: Record<string, boolean>;
}) {
  const targetWorkspace = input.workspaceId ?? workspaceId;
  await env.DB.prepare(
    `INSERT INTO social_connections
      (id, workspace_id, platform, external_account_id, display_name, status, capabilities_json)
     VALUES (?, ?, ?, ?, ?, 'connected', ?)`,
  ).bind(
    input.id,
    targetWorkspace,
    input.platform ?? 'instagram',
    `external:${input.id}`,
    `Compte ${input.id}`,
    JSON.stringify(input.capabilities ?? {}),
  ).run();
}

function principal(subject = 'automation-agent'): WorkspacePrincipal {
  return {
    subject,
    email: `${subject}@example.test`,
    workspaceId,
    workspaceName: 'Automation Test',
    role: 'agent',
    memberId: `member:${subject}`,
  };
}

describe('automation drafts', () => {
  it('persists an account-scoped draft but refuses activation even with capabilities', async () => {
    await ensureWorkspace(workspaceId, 'Automation Test');
    await insertConnection({
      id: 'automation-connection-capable',
      capabilities: { direct_messages: true, comments: true },
    });

    const created = await createAutomationDraft(env.DB, principal(), {
      name: 'Qualification commentaires',
      connectionId: 'automation-connection-capable',
      platform: 'instagram',
      triggerType: 'comment',
      triggerConfig: { contains: ['date', 'venir'] },
      actionConfig: { type: 'move_stage', stage: 'Qualifié' },
    });

    expect(created).toMatchObject({
      connectionId: 'automation-connection-capable',
      name: 'Qualification commentaires',
      platform: 'instagram',
      triggerType: 'comment',
      active: false,
      version: 1,
      executionReady: false,
      missingCapabilities: [],
    });

    await expect(createAutomationDraft(env.DB, principal(), {
      name: 'Ne doit pas partir',
      connectionId: 'automation-connection-capable',
      platform: 'instagram',
      triggerType: 'incoming_message',
      triggerConfig: {},
      actionConfig: { type: 'send_message', template: 'Bonjour' },
      active: true,
    })).rejects.toMatchObject({ code: 'AUTOMATION_EXECUTION_NOT_READY' });

    const audit = await env.DB.prepare(
      `SELECT action, metadata_json
       FROM audit_logs
       WHERE workspace_id = ? AND actor_id = ? AND resource_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(workspaceId, principal().subject, created.id).first<{ action: string; metadata_json: string }>();
    expect(audit?.action).toBe('automation.draft_created');
    expect(audit?.metadata_json).not.toContain('date');
    expect(audit?.metadata_json).not.toContain('Bonjour');
  });

  it('surfaces missing account capabilities without pretending the draft can execute', async () => {
    await insertConnection({
      id: 'automation-connection-limited',
      capabilities: { comments: true, direct_messages: false },
    });

    const created = await createAutomationDraft(env.DB, principal('automation-limited-agent'), {
      name: 'Réponse DM impossible',
      connectionId: 'automation-connection-limited',
      platform: 'instagram',
      triggerType: 'comment',
      triggerConfig: {},
      actionConfig: { type: 'send_message', template: 'Merci pour votre commentaire' },
    });

    expect(created.executionReady).toBe(false);
    expect(created.missingCapabilities).toEqual(['direct_messages']);
  });

  it('enforces connection tenant/platform scope', async () => {
    await ensureWorkspace(otherWorkspaceId, 'Automation Other');
    await insertConnection({
      id: 'automation-other-connection',
      workspaceId: otherWorkspaceId,
      capabilities: { direct_messages: true },
    });

    await expect(createAutomationDraft(env.DB, principal(), {
      name: 'Cross tenant interdit',
      connectionId: 'automation-other-connection',
      platform: 'instagram',
      triggerType: 'incoming_message',
      triggerConfig: {},
      actionConfig: { type: 'move_stage', stage: 'Qualifié' },
    })).rejects.toMatchObject({ code: 'CONNECTION_NOT_FOUND' });

    await insertConnection({ id: 'automation-youtube-connection', platform: 'youtube', capabilities: { comments: true } });
    await expect(createAutomationDraft(env.DB, principal(), {
      name: 'Plateforme incohérente',
      connectionId: 'automation-youtube-connection',
      platform: 'instagram',
      triggerType: 'comment',
      triggerConfig: {},
      actionConfig: { type: 'move_stage', stage: 'Qualifié' },
    })).rejects.toMatchObject({ code: 'CONNECTION_NOT_FOUND' });
  });

  it('uses optimistic versions for update and archive, then hides archived drafts', async () => {
    await insertConnection({
      id: 'automation-versioned-connection',
      capabilities: { direct_messages: true },
    });
    const actor = principal('automation-version-agent');
    const created = await createAutomationDraft(env.DB, actor, {
      name: 'Qualification DM',
      connectionId: 'automation-versioned-connection',
      platform: 'instagram',
      triggerType: 'incoming_message',
      triggerConfig: { contains: ['club'] },
      actionConfig: { type: 'move_stage', stage: 'Qualifié' },
    });

    const updated = await updateAutomationDraft(env.DB, actor, created.id, {
      expectedVersion: created.version,
      name: 'Qualification DM v2',
      actionConfig: { type: 'set_priority', priority: 'high' },
    });
    expect(updated).toMatchObject({ name: 'Qualification DM v2', version: 2, active: false });

    await expect(updateAutomationDraft(env.DB, actor, created.id, {
      expectedVersion: 1,
      name: 'Écrasement obsolète',
    })).rejects.toMatchObject({ code: 'AUTOMATION_CONFLICT' });

    await expect(updateAutomationDraft(env.DB, actor, created.id, {
      expectedVersion: 2,
      active: true,
    })).rejects.toMatchObject({ code: 'AUTOMATION_EXECUTION_NOT_READY' });

    await archiveAutomationDraft(env.DB, actor, created.id, 2);
    const listed = await listAutomationDrafts(env.DB, workspaceId, { connectionId: 'automation-versioned-connection' });
    expect(listed.automations.find((automation) => automation.id === created.id)).toBeUndefined();

    await expect(archiveAutomationDraft(env.DB, actor, created.id, 2))
      .rejects.toMatchObject({ code: 'AUTOMATION_NOT_FOUND' });
  });

  it('lists only the requested workspace/account', async () => {
    const result = await listAutomationDrafts(env.DB, workspaceId, { connectionId: 'automation-connection-capable' });
    expect(result.executionReady).toBe(false);
    expect(result.automations.length).toBeGreaterThan(0);
    expect(result.automations.every((automation) => automation.connectionId === 'automation-connection-capable')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('automation-other-connection');
  });
});
