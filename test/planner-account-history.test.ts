import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { listRemotePlannerPublications } from '../src/worker/planner-account-history';

describe('provider Planner history', () => {
  it('maps published and scheduled provider content into the Planner shape', async () => {
    const suffix = crypto.randomUUID();
    const instagramConnection = `ig-history-${suffix}`;
    const youtubeConnection = `yt-history-${suffix}`;
    const now = new Date().toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO social_connections
          (id, workspace_id, platform, external_account_id, display_name, handle, status, capabilities_json, created_at, updated_at)
         VALUES (?, 'default', 'instagram', ?, 'Instagram · Neptune Test', '@neptune_test', 'connected', '{}', ?, ?)`,
      ).bind(instagramConnection, `ig-external-${suffix}`, now, now),
      env.DB.prepare(
        `INSERT INTO social_connections
          (id, workspace_id, platform, external_account_id, display_name, handle, status, capabilities_json, created_at, updated_at)
         VALUES (?, 'default', 'youtube', ?, 'YouTube · Neptune Test', '@neptune_test', 'connected', '{}', ?, ?)`,
      ).bind(youtubeConnection, `yt-external-${suffix}`, now, now),
    ]);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO planner_remote_posts
          (id, workspace_id, connection_id, platform, external_id, body, media_type, visibility,
           external_url, provider_status, event_at, created_at, updated_at)
         VALUES (?, 'default', ?, 'instagram', ?, 'Post Instagram existant', 'IMAGE', NULL,
           'https://www.instagram.com/p/example/', 'published', '2026-09-14T09:00:00.000Z', ?, ?)`,
      ).bind(crypto.randomUUID(), instagramConnection, `ig-post-${suffix}`, now, now),
      env.DB.prepare(
        `INSERT INTO planner_remote_posts
          (id, workspace_id, connection_id, platform, external_id, body, media_type, visibility,
           external_url, provider_status, event_at, created_at, updated_at)
         VALUES (?, 'default', ?, 'youtube', ?, 'Vidéo YouTube programmée', 'VIDEO', 'private',
           'https://www.youtube.com/watch?v=test123', 'scheduled', '2026-09-20T11:00:00.000Z', ?, ?)`,
      ).bind(crypto.randomUUID(), youtubeConnection, `yt-video-${suffix}`, now, now),
    ]);

    const publications = await listRemotePlannerPublications(env.DB, 'default');
    const instagram = publications.find((item) => item.targets[0]?.connectionId === instagramConnection);
    const youtube = publications.find((item) => item.targets[0]?.connectionId === youtubeConnection);

    expect(instagram).toMatchObject({
      source: 'provider',
      readOnly: true,
      status: 'completed',
      providerStatus: 'published',
      body: 'Post Instagram existant',
    });
    expect(instagram?.targets[0]).toMatchObject({
      platform: 'instagram',
      status: 'published',
      connected: true,
    });

    expect(youtube).toMatchObject({
      source: 'provider',
      readOnly: true,
      status: 'scheduled',
      providerStatus: 'scheduled',
      body: 'Vidéo YouTube programmée',
    });
    expect(youtube?.targets[0]).toMatchObject({
      platform: 'youtube',
      status: 'scheduled',
      format: 'video',
      fields: { privacyStatus: 'private' },
    });
  });
});
