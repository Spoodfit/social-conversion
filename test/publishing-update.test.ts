import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { WorkspacePrincipal } from '../src/worker/authorization';
import { createPublication } from '../src/worker/publishing';
import { updatePublication } from '../src/worker/publishing-update';

function principal(): WorkspacePrincipal {
  return {
    subject: 'publishing-update-test-subject',
    email: 'publishing-update@example.test',
    workspaceId: 'default',
    workspaceName: 'Neptune Business Club',
    role: 'admin',
    memberId: 'publishing-update-test-member',
  };
}

async function createConnection() {
  const id = `publishing-update-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO social_connections
      (id, workspace_id, platform, display_name, handle, status)
     VALUES (?, 'default', 'instagram', ?, '@publishing_update', 'connected')`,
  ).bind(id, `Compte ${id.slice(-6)}`).run();
  return id;
}

describe('publication full update', () => {
  it('updates the same scheduled publication in place with optimistic versioning', async () => {
    const firstConnection = await createConnection();
    const secondConnection = await createConnection();
    const original = await createPublication(env.DB, principal(), {
      body: 'Texte initial',
      scheduledAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      connectionIds: [firstConnection],
    });
    const nextDate = new Date(Date.now() + 3 * 60 * 60 * 1_000).toISOString();

    const updated = await updatePublication(env.DB, principal(), original.id, {
      body: 'Texte modifié sans annuler le post',
      scheduledAt: nextDate,
      connectionIds: [secondConnection],
      expectedVersion: original.version,
    });

    expect(updated.id).toBe(original.id);
    expect(updated.version).toBe(original.version + 1);
    expect(updated.body).toBe('Texte modifié sans annuler le post');
    expect(updated.scheduledAt).toBe(nextDate);
    expect(updated.targets.map((target) => target.connectionId)).toEqual([secondConnection]);

    await expect(updatePublication(env.DB, principal(), original.id, {
      body: 'Écrasement obsolète',
      scheduledAt: new Date(Date.now() + 4 * 60 * 60 * 1_000).toISOString(),
      connectionIds: [firstConnection],
      expectedVersion: original.version,
    })).rejects.toMatchObject({ code: 'PUBLICATION_CONFLICT' });
  });
});
