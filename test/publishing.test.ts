import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { WorkspacePrincipal } from '../src/worker/authorization';
import {
  cancelPublication,
  createPublication,
  listPublications,
} from '../src/worker/publishing';

function principal(): WorkspacePrincipal {
  return {
    subject: 'publishing-test-subject',
    email: 'publishing@example.test',
    workspaceId: 'default',
    workspaceName: 'Neptune Business Club',
    role: 'admin',
    memberId: 'publishing-test-member',
  };
}

async function createConnection(status: 'connected' | 'pending' = 'connected') {
  const id = `publishing-connection-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO social_connections
      (id, workspace_id, platform, display_name, handle, status)
     VALUES (?, 'default', 'instagram', ?, '@publishing_test', ?)`,
  ).bind(id, `Instagram test ${id.slice(-6)}`, status).run();
  return id;
}

describe('content publishing scheduler', () => {
  it('creates, lists and cancels a persisted multi-target publication', async () => {
    const firstConnection = await createConnection();
    const secondConnection = await createConnection();
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();

    const publication = await createPublication(env.DB, principal(), {
      body: 'Publication Social Conversion test',
      scheduledAt,
      connectionIds: [firstConnection, secondConnection],
    });

    expect(publication).toMatchObject({
      body: 'Publication Social Conversion test',
      status: 'scheduled',
      version: 1,
    });
    expect(publication.targets).toHaveLength(2);
    expect(new Set(publication.targets.map((target) => target.connectionId))).toEqual(new Set([firstConnection, secondConnection]));

    const listed = await listPublications(env.DB, 'default');
    expect(listed.publications.some((candidate) => candidate.id === publication.id)).toBe(true);

    const cancelled = await cancelPublication(env.DB, principal(), publication.id, publication.version);
    expect(cancelled).toEqual({ id: publication.id, status: 'cancelled', version: 2 });

    const afterCancellation = await listPublications(env.DB, 'default');
    expect(afterCancellation.publications.some((candidate) => candidate.id === publication.id)).toBe(false);
  });

  it('fails closed when a selected social connection is not ready', async () => {
    const pendingConnection = await createConnection('pending');

    await expect(createPublication(env.DB, principal(), {
      body: 'Cette publication ne doit pas être acceptée',
      scheduledAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      connectionIds: [pendingConnection],
    })).rejects.toMatchObject({ code: 'CONNECTION_NOT_READY' });
  });
});
