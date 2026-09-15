import { loadOAuthTokens, tokenKeyringSecret } from './token-vault';

type PlannerPlatform = 'instagram' | 'youtube' | 'tiktok';
type ProviderStatus = 'published' | 'scheduled';

type ConnectionRow = {
  id: string;
  platform: PlannerPlatform;
  external_account_id: string | null;
  display_name: string;
  handle: string | null;
};

type RemotePostInput = {
  externalId: string;
  body: string;
  mediaType?: string;
  visibility?: string;
  externalUrl?: string;
  providerStatus: ProviderStatus;
  eventAt: string;
};

type RemotePostRow = {
  id: string;
  connection_id: string;
  platform: PlannerPlatform;
  external_id: string;
  body: string;
  media_type: string | null;
  visibility: string | null;
  external_url: string | null;
  provider_status: ProviderStatus;
  event_at: string;
  created_at: string;
  updated_at: string;
  display_name: string;
  handle: string | null;
};

type InstagramMedia = {
  id?: unknown;
  caption?: unknown;
  media_type?: unknown;
  permalink?: unknown;
  timestamp?: unknown;
};

type YoutubeVideo = {
  id?: unknown;
  snippet?: {
    title?: unknown;
    description?: unknown;
    publishedAt?: unknown;
  };
  status?: {
    privacyStatus?: unknown;
    publishAt?: unknown;
  };
};

const SYNC_THROTTLE_MS = 2 * 60_000;
const MAX_YOUTUBE_ITEMS = 100;

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function graphVersion(env: Env): string | undefined {
  const value = envString(env, 'META_GRAPH_VERSION');
  return value && /^v\d{1,3}\.\d{1,2}$/.test(value) ? value : undefined;
}

function safeText(value: unknown, maximum = 5_000): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function providerJson(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Provider history request failed with HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function syncAllowed(
  db: D1Database,
  workspaceId: string,
  connectionId: string,
  platform: PlannerPlatform,
): Promise<boolean> {
  const state = await db.prepare(
    `SELECT last_attempt_at FROM planner_remote_sync_state
     WHERE workspace_id = ? AND connection_id = ? AND platform = ?`,
  ).bind(workspaceId, connectionId, platform).first<{ last_attempt_at: string | null }>();
  if (!state?.last_attempt_at) return true;
  const lastAttempt = Date.parse(state.last_attempt_at);
  return !Number.isFinite(lastAttempt) || Date.now() - lastAttempt >= SYNC_THROTTLE_MS;
}

async function markAttempt(
  db: D1Database,
  workspaceId: string,
  connectionId: string,
  platform: PlannerPlatform,
) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO planner_remote_sync_state
       (workspace_id, connection_id, platform, last_attempt_at, last_success_at, last_error)
     VALUES (?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(workspace_id, connection_id, platform) DO UPDATE SET
       last_attempt_at = excluded.last_attempt_at,
       last_error = NULL`,
  ).bind(workspaceId, connectionId, platform, now).run();
}

async function markSuccess(
  db: D1Database,
  workspaceId: string,
  connectionId: string,
  platform: PlannerPlatform,
) {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE planner_remote_sync_state
     SET last_success_at = ?, last_error = NULL
     WHERE workspace_id = ? AND connection_id = ? AND platform = ?`,
  ).bind(now, workspaceId, connectionId, platform).run();
  await db.prepare(
    `UPDATE social_connections SET last_synced_at = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`,
  ).bind(now, now, connectionId, workspaceId).run();
}

async function markFailure(
  db: D1Database,
  workspaceId: string,
  connectionId: string,
  platform: PlannerPlatform,
  error: unknown,
) {
  const message = (error instanceof Error ? error.message : 'Provider history sync failed.').slice(0, 800);
  await db.prepare(
    `UPDATE planner_remote_sync_state SET last_error = ?
     WHERE workspace_id = ? AND connection_id = ? AND platform = ?`,
  ).bind(message, workspaceId, connectionId, platform).run();
}

async function upsertRemotePosts(
  db: D1Database,
  workspaceId: string,
  connection: ConnectionRow,
  posts: RemotePostInput[],
) {
  if (!posts.length) return;
  const now = new Date().toISOString();
  const statements = posts.map((post) => db.prepare(
    `INSERT INTO planner_remote_posts
       (id, workspace_id, connection_id, platform, external_id, body, media_type, visibility,
        external_url, provider_status, event_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, connection_id, platform, external_id) DO UPDATE SET
       body = excluded.body,
       media_type = excluded.media_type,
       visibility = excluded.visibility,
       external_url = excluded.external_url,
       provider_status = excluded.provider_status,
       event_at = excluded.event_at,
       updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(),
    workspaceId,
    connection.id,
    connection.platform,
    post.externalId,
    post.body,
    post.mediaType ?? null,
    post.visibility ?? null,
    post.externalUrl ?? null,
    post.providerStatus,
    post.eventAt,
    now,
    now,
  ));
  await db.batch(statements);
}

async function cleanupMissingScheduled(
  db: D1Database,
  workspaceId: string,
  connection: ConnectionRow,
  currentIds: string[],
) {
  if (!currentIds.length) {
    await db.prepare(
      `DELETE FROM planner_remote_posts
       WHERE workspace_id = ? AND connection_id = ? AND platform = ? AND provider_status = 'scheduled'`,
    ).bind(workspaceId, connection.id, connection.platform).run();
    return;
  }
  const placeholders = currentIds.map(() => '?').join(', ');
  await db.prepare(
    `DELETE FROM planner_remote_posts
     WHERE workspace_id = ? AND connection_id = ? AND platform = ?
       AND provider_status = 'scheduled' AND external_id NOT IN (${placeholders})`,
  ).bind(workspaceId, connection.id, connection.platform, ...currentIds).run();
}

async function syncInstagram(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connection: ConnectionRow,
  fetchImpl: typeof fetch,
): Promise<number> {
  const keyring = tokenKeyringSecret(env);
  const version = graphVersion(env);
  if (!keyring || !version) throw new Error('Instagram history configuration is incomplete.');
  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connection.id);
  if (!tokens || tokens.credentials.provider !== 'instagram') throw new Error('Instagram credentials are unavailable.');

  const payload = await providerJson(
    fetchImpl,
    `https://graph.instagram.com/${version}/me/media?fields=id,caption,media_type,permalink,timestamp&limit=100`,
    tokens.accessToken,
  ) as { data?: unknown };
  const data = Array.isArray(payload.data) ? payload.data as InstagramMedia[] : [];
  const posts: RemotePostInput[] = [];
  for (const item of data) {
    const externalId = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : '';
    const eventAt = isoDate(item.timestamp);
    if (!externalId || !eventAt) continue;
    posts.push({
      externalId,
      body: safeText(item.caption) || 'Publication Instagram',
      mediaType: safeText(item.media_type, 40) || undefined,
      externalUrl: safeHttpsUrl(item.permalink),
      providerStatus: 'published',
      eventAt,
    });
  }
  await upsertRemotePosts(db, workspaceId, connection, posts);
  return posts.length;
}

function youtubeIds(items: unknown): Array<{ id: string; publishedAt?: string }> {
  if (!Array.isArray(items)) return [];
  const values: Array<{ id: string; publishedAt?: string }> = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { contentDetails?: { videoId?: unknown }; snippet?: { publishedAt?: unknown } };
    const id = typeof candidate.contentDetails?.videoId === 'string' ? candidate.contentDetails.videoId.trim() : '';
    if (!id) continue;
    values.push({ id, publishedAt: isoDate(candidate.snippet?.publishedAt) });
  }
  return values;
}

async function syncYouTube(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connection: ConnectionRow,
  fetchImpl: typeof fetch,
): Promise<number> {
  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new Error('YouTube history configuration is incomplete.');
  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connection.id);
  if (!tokens || tokens.credentials.provider !== 'youtube') throw new Error('YouTube credentials are unavailable.');
  if (!tokens.credentials.scopes.includes('https://www.googleapis.com/auth/youtube.readonly')) {
    throw new Error('YouTube read permission is missing. Reconnect the channel.');
  }

  const channelPayload = await providerJson(
    fetchImpl,
    'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
    tokens.accessToken,
  ) as { items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: unknown } } }> };
  const uploads = typeof channelPayload.items?.[0]?.contentDetails?.relatedPlaylists?.uploads === 'string'
    ? channelPayload.items[0].contentDetails.relatedPlaylists.uploads
    : '';
  if (!uploads) throw new Error('YouTube uploads playlist is unavailable.');

  const listed: Array<{ id: string; publishedAt?: string }> = [];
  let pageToken = '';
  for (let page = 0; page < 2 && listed.length < MAX_YOUTUBE_ITEMS; page += 1) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', uploads);
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await providerJson(fetchImpl, url.toString(), tokens.accessToken) as { items?: unknown; nextPageToken?: unknown };
    listed.push(...youtubeIds(payload.items));
    pageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : '';
    if (!pageToken) break;
  }

  const fallbackPublishedAt = new Map(listed.map((item) => [item.id, item.publishedAt]));
  const posts: RemotePostInput[] = [];
  for (let offset = 0; offset < listed.length; offset += 50) {
    const ids = listed.slice(offset, offset + 50).map((item) => item.id);
    if (!ids.length) continue;
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,status');
    url.searchParams.set('id', ids.join(','));
    url.searchParams.set('maxResults', '50');
    const payload = await providerJson(fetchImpl, url.toString(), tokens.accessToken) as { items?: unknown };
    const videos = Array.isArray(payload.items) ? payload.items as YoutubeVideo[] : [];
    for (const video of videos) {
      const externalId = typeof video.id === 'string' ? video.id.trim() : '';
      if (!externalId) continue;
      const publishAt = isoDate(video.status?.publishAt);
      const publishedAt = isoDate(video.snippet?.publishedAt) ?? fallbackPublishedAt.get(externalId);
      const isScheduled = Boolean(publishAt && Date.parse(publishAt) > Date.now());
      const eventAt = isScheduled ? publishAt : publishedAt;
      if (!eventAt) continue;
      const title = safeText(video.snippet?.title, 300);
      const description = safeText(video.snippet?.description, 4_600);
      posts.push({
        externalId,
        body: [title, description].filter(Boolean).join('\n\n').slice(0, 5_000) || 'Vidéo YouTube',
        mediaType: 'VIDEO',
        visibility: safeText(video.status?.privacyStatus, 30) || undefined,
        externalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(externalId)}`,
        providerStatus: isScheduled ? 'scheduled' : 'published',
        eventAt,
      });
    }
  }

  await upsertRemotePosts(db, workspaceId, connection, posts);
  await cleanupMissingScheduled(db, workspaceId, connection, posts.map((post) => post.externalId));
  return posts.length;
}

export async function syncWorkspacePlannerHistory(
  db: D1Database,
  env: Env,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ synced: number; skipped: number; failed: number; items: number }> {
  const result = await db.prepare(
    `SELECT id, platform, external_account_id, display_name, handle
     FROM social_connections
     WHERE workspace_id = ? AND status = 'connected' AND platform IN ('instagram', 'youtube')
     ORDER BY platform, display_name`,
  ).bind(workspaceId).all<ConnectionRow>();

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let items = 0;
  for (const connection of result.results) {
    if (!await syncAllowed(db, workspaceId, connection.id, connection.platform)) {
      skipped += 1;
      continue;
    }
    await markAttempt(db, workspaceId, connection.id, connection.platform);
    try {
      const count = connection.platform === 'instagram'
        ? await syncInstagram(db, env, workspaceId, connection, fetchImpl)
        : await syncYouTube(db, env, workspaceId, connection, fetchImpl);
      items += count;
      synced += 1;
      await markSuccess(db, workspaceId, connection.id, connection.platform);
    } catch (error) {
      failed += 1;
      await markFailure(db, workspaceId, connection.id, connection.platform, error);
      console.warn(JSON.stringify({
        event: 'planner_provider_history_sync_failed',
        workspaceId,
        connectionId: connection.id,
        platform: connection.platform,
        message: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
      }));
    }
  }
  return { synced, skipped, failed, items };
}

export async function listRemotePlannerPublications(db: D1Database, workspaceId: string) {
  const result = await db.prepare(
    `SELECT rp.id, rp.connection_id, rp.platform, rp.external_id, rp.body, rp.media_type,
            rp.visibility, rp.external_url, rp.provider_status, rp.event_at, rp.created_at, rp.updated_at,
            sc.display_name, sc.handle
     FROM planner_remote_posts rp
     JOIN social_connections sc ON sc.id = rp.connection_id AND sc.workspace_id = rp.workspace_id
     WHERE rp.workspace_id = ? AND sc.status = 'connected'
     ORDER BY rp.event_at ASC, rp.external_id ASC`,
  ).bind(workspaceId).all<RemotePostRow>();

  return result.results.map((row) => {
    const format = row.platform === 'youtube'
      ? 'video'
      : row.media_type === 'REELS'
        ? 'short'
        : row.media_type === 'VIDEO'
          ? 'video'
          : 'post';
    return {
      id: `provider:${row.id}`,
      body: row.body,
      status: row.provider_status === 'scheduled' ? 'scheduled' : 'completed',
      scheduledAt: row.event_at,
      version: 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: 'provider' as const,
      readOnly: true,
      externalUrl: row.external_url ?? undefined,
      providerStatus: row.provider_status,
      targets: [{
        id: `provider-target:${row.id}`,
        connectionId: row.connection_id,
        platform: row.platform,
        status: row.provider_status === 'scheduled' ? 'scheduled' : 'published',
        displayName: row.display_name,
        handle: row.handle ?? undefined,
        format,
        fields: row.visibility ? { privacyStatus: row.visibility } : {},
        connected: true,
        connectionStatus: 'connected',
        syncStatus: row.provider_status === 'scheduled' ? 'scheduled' : 'uploaded',
        externalId: row.external_id,
        externalUrl: row.external_url ?? undefined,
        syncedAt: row.updated_at,
      }],
    };
  });
}
