import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { listRemotePlannerPublications } from '../src/worker/planner-account-history';

describe('synchronized Planner visual previews', () => {
  it('exposes provider thumbnails and hydrates editable provider fields', async () => {
    const suffix = crypto.randomUUID();
    const instagramConnection = `ig-preview-${suffix}`;
    const youtubeConnection = `yt-preview-${suffix}`;
    const now = new Date().toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO social_connections
          (id, workspace_id, platform, external_account_id, display_name, handle, status, capabilities_json, created_at, updated_at)
         VALUES (?, 'default', 'instagram', ?, 'Instagram · Preview', '@preview_ig', 'connected', '{}', ?, ?)`,
      ).bind(instagramConnection, `ig-ext-${suffix}`, now, now),
      env.DB.prepare(
        `INSERT INTO social_connections
          (id, workspace_id, platform, external_account_id, display_name, handle, status, capabilities_json, created_at, updated_at)
         VALUES (?, 'default', 'youtube', ?, 'YouTube · Preview', '@preview_yt', 'connected', '{}', ?, ?)`,
      ).bind(youtubeConnection, `yt-ext-${suffix}`, now, now),
    ]);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO planner_remote_posts
          (id, workspace_id, connection_id, platform, external_id, body, media_type, visibility,
           external_url, preview_url, provider_status, event_at, created_at, updated_at)
         VALUES (?, 'default', ?, 'instagram', ?, 'Une légende Instagram', 'VIDEO', NULL,
           'https://www.instagram.com/reel/example/', 'https://scontent.cdninstagram.com/example.jpg', 'published',
           '2026-09-15T08:00:00.000Z', ?, ?)`,
      ).bind(crypto.randomUUID(), instagramConnection, `ig-post-${suffix}`, now, now),
      env.DB.prepare(
        `INSERT INTO planner_remote_posts
          (id, workspace_id, connection_id, platform, external_id, body, media_type, visibility,
           external_url, preview_url, provider_status, event_at, created_at, updated_at)
         VALUES (?, 'default', ?, 'youtube', ?, 'Titre YouTube\n\nDescription YouTube', 'VIDEO', 'private',
           'https://www.youtube.com/watch?v=test123', 'https://i.ytimg.com/vi/test123/hqdefault.jpg', 'scheduled',
           '2026-09-20T11:00:00.000Z', ?, ?)`,
      ).bind(crypto.randomUUID(), youtubeConnection, `yt-video-${suffix}`, now, now),
    ]);

    const publications = await listRemotePlannerPublications(env.DB, 'default');
    const instagram = publications.find((item) => item.targets[0]?.connectionId === instagramConnection);
    const youtube = publications.find((item) => item.targets[0]?.connectionId === youtubeConnection);

    expect(instagram).toMatchObject({
      previewUrl: 'https://scontent.cdninstagram.com/example.jpg',
      providerMediaType: 'VIDEO',
      providerEditable: false,
    });
    expect(instagram?.targets[0]?.fields).toEqual({ caption: 'Une légende Instagram' });

    expect(youtube).toMatchObject({
      previewUrl: 'https://i.ytimg.com/vi/test123/hqdefault.jpg',
      providerEditable: true,
    });
    expect(youtube?.targets[0]?.fields).toMatchObject({
      title: 'Titre YouTube',
      description: 'Description YouTube',
      privacyStatus: 'private',
    });
  });
});
