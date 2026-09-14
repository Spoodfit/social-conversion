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
    expect(publication.targets.every((target) => target.connected)).toBe(true);

    const listed = await listPublications(env.DB, 'default');
    expect(listed.publications.some((candidate) => candidate.id === publication.id)).toBe(true);

    const cancelled = await cancelPublication(env.DB, principal(), publication.id, publication.version);
    expect(cancelled).toEqual({ id: publication.id, status: 'cancelled', version: 2 });

    const afterCancellation = await listPublications(env.DB, 'default');
    expect(afterCancellation.publications.some((candidate) => candidate.id === publication.id)).toBe(false);
  });

  it('keeps a pending account usable in the Planner without claiming it can publish', async () => {
    const pendingConnection = await createConnection('pending');

    const publication = await createPublication(env.DB, principal(), {
      body: 'Préparée avant connexion complète',
      scheduledAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      connectionIds: [pendingConnection],
    });

    expect(publication.targets).toHaveLength(1);
    expect(publication.targets[0]).toMatchObject({
      connectionId: pendingConnection,
      platform: 'instagram',
      status: 'planned',
      connected: false,
    });
  });

  it('creates a YouTube Planner item without any connected account and preserves YouTube fields', async () => {
    const publication = await createPublication(env.DB, principal(), {
      body: '',
      scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString(),
      destinations: [{
        platform: 'youtube',
        accountLabel: 'YouTube Neptune',
        format: 'video',
        fields: {
          title: 'Comment fonctionne Neptune Business ?',
          description: 'Description complète de la vidéo',
          tags: ['entrepreneuriat', 'réseau'],
          privacyStatus: 'private',
          madeForKids: false,
        },
      }],
    });

    expect(publication.body).toBe('Comment fonctionne Neptune Business ?');
    expect(publication.targets[0]).toMatchObject({
      platform: 'youtube',
      displayName: 'YouTube Neptune',
      format: 'video',
      connected: false,
      status: 'planned',
    });
    expect(publication.targets[0]?.fields).toMatchObject({
      title: 'Comment fonctionne Neptune Business ?',
      privacyStatus: 'private',
      madeForKids: false,
    });
  });

  it('stores TikTok-specific interaction settings independently', async () => {
    const publication = await createPublication(env.DB, principal(), {
      body: 'TikTok à préparer',
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1_000).toISOString(),
      destinations: [{
        platform: 'tiktok',
        accountLabel: 'TikTok Neptune',
        format: 'video',
        fields: {
          title: 'TikTok à préparer #business',
          privacyLevel: '',
          allowComments: true,
          allowDuet: false,
          allowStitch: true,
          coverTimestampMs: 2000,
        },
      }],
    });

    expect(publication.targets[0]?.fields).toMatchObject({
      title: 'TikTok à préparer #business',
      allowComments: true,
      allowDuet: false,
      allowStitch: true,
      coverTimestampMs: 2000,
    });
  });
});
