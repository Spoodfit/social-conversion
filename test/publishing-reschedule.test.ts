import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { WorkspacePrincipal } from '../src/worker/authorization';
import { createPublication } from '../src/worker/publishing';
import { reschedulePublication } from '../src/worker/publishing-reschedule';

function principal(): WorkspacePrincipal {
  return {
    subject: 'planner-reschedule-subject',
    email: 'planner-reschedule@example.test',
    workspaceId: 'default',
    workspaceName: 'Neptune Business Club',
    role: 'admin',
    memberId: 'planner-reschedule-member',
  };
}

async function createConnection() {
  const id = `planner-reschedule-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO social_connections
      (id, workspace_id, platform, display_name, handle, status)
     VALUES (?, 'default', 'instagram', 'Instagram planner', '@planner', 'connected')`,
  ).bind(id).run();
  return id;
}

describe('planner publication rescheduling', () => {
  it('persists a new date and increments the optimistic version', async () => {
    const connectionId = await createConnection();
    const publication = await createPublication(env.DB, principal(), {
      body: 'Déplacer cette publication',
      scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString(),
      connectionIds: [connectionId],
    });
    const nextDate = new Date(Date.now() + 26 * 60 * 60 * 1_000).toISOString();

    const moved = await reschedulePublication(
      env.DB,
      principal(),
      publication.id,
      nextDate,
      publication.version,
    );

    expect(moved.id).toBe(publication.id);
    expect(moved.version).toBe(publication.version + 1);
    expect(new Date(moved.scheduledAt).toISOString()).toBe(new Date(nextDate).toISOString());
  });

  it('rejects stale drag-and-drop updates', async () => {
    const connectionId = await createConnection();
    const publication = await createPublication(env.DB, principal(), {
      body: 'Version protégée',
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1_000).toISOString(),
      connectionIds: [connectionId],
    });

    await expect(reschedulePublication(
      env.DB,
      principal(),
      publication.id,
      new Date(Date.now() + 30 * 60 * 60 * 1_000).toISOString(),
      publication.version + 8,
    )).rejects.toMatchObject({ code: 'PUBLICATION_CONFLICT' });
  });
});
