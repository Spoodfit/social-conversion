import type { NormalizedSocialEvent } from '../shared/types';
import { persistSocialEvent } from './persistence';
import { loadOAuthTokens, saveOAuthCredentials, tokenKeyringSecret } from './token-vault';

type SyncPlatform = 'instagram' | 'youtube';

type ConnectionRow = {
  id: string;
  platform: SyncPlatform;
  display_name: string;
};

type InstagramComment = {
  id?: unknown;
  text?: unknown;
  timestamp?: unknown;
  from?: { id?: unknown; username?: unknown };
};

type YouTubeCommentThread = {
  snippet?: {
    topLevelComment?: {
      id?: unknown;
      snippet?: {
        authorChannelId?: { value?: unknown };
        authorDisplayName?: unknown;
        textOriginal?: unknown;
        publishedAt?: unknown;
      };
    };
  };
};

const SYNC_THROTTLE_MS = 2 * 60_000;
const MAX_INSTAGRAM_MEDIA = 20;
const MAX_YOUTUBE_VIDEOS = 20;
const PARALLEL_REQUESTS = 5;

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function graphVersion(env: Env): string | undefined {
  const value = envString(env, 'META_GRAPH_VERSION');
  return value && /^v\d{1,3}\.\d{1,2}$/.test(value) ? value : undefined;
}

function stringValue(value: unknown, maximum = 5_000): string {
  if (typeof value === 'string') return value.trim().slice(0, maximum);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`Provider returned invalid JSON (${response.status}).`);
  }
}

async function providerGet(fetchImpl: typeof fetch, url: string, accessToken: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function syncAllowed(db: D1Database, workspaceId: string, connectionId: string, platform: SyncPlatform): Promise<boolean> {
  const row = await db.prepare(
    `SELECT last_attempt_at FROM provider_inbox_sync_state
     WHERE workspace_id = ? AND connection_id = ? AND platform = ?`,
  ).bind(workspaceId, connectionId, platform).first<{ last_attempt_at: string | null }>();
  if (!row?.last_attempt_at) return true;
  const last = Date.parse(row.last_attempt_at);
  return !Number.isFinite(last) || Date.now() - last >= SYNC_THROTTLE_MS;
}

async function markAttempt(db: D1Database, workspaceId: string, connectionId: string, platform: SyncPlatform) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO provider_inbox_sync_state
       (workspace_id, connection_id, platform, last_attempt_at, last_success_at, last_error)
     VALUES (?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(workspace_id, connection_id, platform) DO UPDATE SET
       last_attempt_at = excluded.last_attempt_at,
       last_error = NULL`,
  ).bind(workspaceId, connectionId, platform, now).run();
}

async function markSuccess(db: D1Database, workspaceId: string, connectionId: string, platform: SyncPlatform) {
  await db.prepare(
    `UPDATE provider_inbox_sync_state
     SET last_success_at = ?, last_error = NULL
     WHERE workspace_id = ? AND connection_id = ? AND platform = ?`,
  ).bind(new Date().toISOString(), workspaceId, connectionId, platform).run();
}

async function markFailure(db: D1Database, workspaceId: string, connectionId: string, platform: SyncPlatform, error: unknown) {
  const message = (error instanceof Error ? error.message : 'Provider inbox sync failed.').slice(0, 800);
  await db.prepare(
    `UPDATE provider_inbox_sync_state SET last_error = ?
     WHERE workspace_id = ? AND connection_id = ? AND platform = ?`,
  ).bind(message, workspaceId, connectionId, platform).run();
}

async function mapInBatches<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += PARALLEL_REQUESTS) {
    await Promise.allSettled(items.slice(offset, offset + PARALLEL_REQUESTS).map(worker));
  }
}

export function normalizeInstagramComments(
  connection: { id: string },
  workspaceId: string,
  comments: InstagramComment[],
): NormalizedSocialEvent[] {
  const events: NormalizedSocialEvent[] = [];
  for (const comment of comments) {
    const commentId = stringValue(comment.id, 200);
    const text = stringValue(comment.text);
    const authorId = stringValue(comment.from?.id, 200);
    const username = stringValue(comment.from?.username, 100);
    if (!commentId || !text || !authorId) continue;
    events.push({
      id: `${connection.id}:${commentId}`,
      externalEventId: commentId,
      platform: 'instagram',
      workspaceId,
      connectionId: connection.id,
      eventType: 'comment',
      externalContactId: authorId,
      contactName: username ? `@${username}` : `Contact ${authorId.slice(-4)}`,
      text,
      occurredAt: isoDate(comment.timestamp) ?? new Date().toISOString(),
    });
  }
  return events;
}

export function normalizeYouTubeCommentThreads(
  connection: { id: string },
  workspaceId: string,
  threads: YouTubeCommentThread[],
): NormalizedSocialEvent[] {
  const events: NormalizedSocialEvent[] = [];
  for (const thread of threads) {
    const topLevel = thread.snippet?.topLevelComment;
    const snippet = topLevel?.snippet;
    const commentId = stringValue(topLevel?.id, 200);
    const text = stringValue(snippet?.textOriginal);
    const authorName = stringValue(snippet?.authorDisplayName, 180);
    const authorChannelId = stringValue(snippet?.authorChannelId?.value, 200);
    if (!commentId || !text) continue;
    const externalContactId = authorChannelId || `comment:${commentId}`;
    events.push({
      id: `${connection.id}:youtube-comment:${commentId}`,
      externalEventId: commentId,
      platform: 'youtube',
      workspaceId,
      connectionId: connection.id,
      eventType: 'comment',
      externalContactId,
      contactName: authorName || 'Utilisateur YouTube',
      text,
      occurredAt: isoDate(snippet?.publishedAt) ?? new Date().toISOString(),
    });
  }
  return events;
}

async function syncInstagramComments(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connection: ConnectionRow,
  fetchImpl: typeof fetch,
): Promise<number> {
  const keyring = tokenKeyringSecret(env);
  const version = graphVersion(env);
  if (!keyring || !version) throw new Error('Instagram inbox sync configuration is incomplete.');
  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connection.id);
  if (!tokens || tokens.credentials.provider !== 'instagram') throw new Error('Instagram credentials are unavailable.');
  if (!tokens.credentials.scopes.includes('instagram_business_manage_comments')) {
    throw new Error('Instagram comment permission is missing. Reconnect the account.');
  }

  const mediaUrl = new URL(`https://graph.instagram.com/${version}/me/media`);
  mediaUrl.searchParams.set('fields', 'id');
  mediaUrl.searchParams.set('limit', String(MAX_INSTAGRAM_MEDIA));
  const mediaResponse = await providerGet(fetchImpl, mediaUrl.toString(), tokens.accessToken);
  if (!mediaResponse.ok) throw new Error(`Instagram media request failed (${mediaResponse.status}).`);
  const mediaPayload = await readJson(mediaResponse) as { data?: unknown };
  const mediaIds = (Array.isArray(mediaPayload.data) ? mediaPayload.data : [])
    .map((item) => item && typeof item === 'object' ? stringValue((item as { id?: unknown }).id, 200) : '')
    .filter(Boolean)
    .slice(0, MAX_INSTAGRAM_MEDIA);

  let persisted = 0;
  await mapInBatches(mediaIds, async (mediaId) => {
    const commentsUrl = new URL(`https://graph.instagram.com/${version}/${encodeURIComponent(mediaId)}/comments`);
    commentsUrl.searchParams.set('fields', 'id,text,timestamp,from{id,username}');
    commentsUrl.searchParams.set('limit', '100');
    const response = await providerGet(fetchImpl, commentsUrl.toString(), tokens.accessToken);
    if (response.status === 400 || response.status === 403) return;
    if (!response.ok) throw new Error(`Instagram comments request failed (${response.status}).`);
    const payload = await readJson(response) as { data?: unknown };
    const comments = Array.isArray(payload.data) ? payload.data as InstagramComment[] : [];
    for (const event of normalizeInstagramComments(connection, workspaceId, comments)) {
      const result = await persistSocialEvent(db, event);
      if (result === 'created') persisted += 1;
    }
  });
  return persisted;
}

async function refreshYouTubeAccessToken(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connectionId: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  const clientId = envString(env, 'YOUTUBE_CLIENT_ID');
  const clientSecret = envString(env, 'YOUTUBE_CLIENT_SECRET');
  if (!keyring || !clientId || !clientSecret) throw new Error('YouTube OAuth refresh configuration is incomplete.');
  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connectionId);
  if (!tokens || tokens.credentials.provider !== 'youtube' || !tokens.refreshToken) {
    throw new Error('YouTube refresh token is unavailable. Reconnect the channel.');
  }
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!response.ok) throw new Error(`YouTube token refresh failed (${response.status}).`);
  const payload = await readJson(response) as { access_token?: unknown; expires_in?: unknown };
  const accessToken = stringValue(payload.access_token, 10_000);
  if (!accessToken) throw new Error('YouTube did not return a refreshed access token.');
  const lifetime = Number(payload.expires_in) || 3600;
  await saveOAuthCredentials(db, keyring, {
    workspaceId,
    connectionId,
    provider: 'youtube',
    accessToken,
    scopes: tokens.credentials.scopes,
    accessExpiresAt: new Date(Date.now() + lifetime * 1_000).toISOString(),
  });
  return accessToken;
}

async function youtubeAccessToken(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connectionId: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new Error('YouTube inbox sync configuration is incomplete.');
  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connectionId);
  if (!tokens || tokens.credentials.provider !== 'youtube') throw new Error('YouTube credentials are unavailable.');
  if (!tokens.credentials.scopes.includes('https://www.googleapis.com/auth/youtube.readonly')) {
    throw new Error('YouTube read permission is missing. Reconnect the channel.');
  }
  const expiresAt = tokens.credentials.accessExpiresAt ? Date.parse(tokens.credentials.accessExpiresAt) : Number.POSITIVE_INFINITY;
  if (expiresAt > Date.now() + 2 * 60_000) return tokens.accessToken;
  return refreshYouTubeAccessToken(db, env, workspaceId, connectionId, fetchImpl);
}

async function syncYouTubeComments(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connection: ConnectionRow,
  fetchImpl: typeof fetch,
): Promise<number> {
  let accessToken = await youtubeAccessToken(db, env, workspaceId, connection.id, fetchImpl);
  const videos = await db.prepare(
    `SELECT external_id
     FROM planner_remote_posts
     WHERE workspace_id = ? AND connection_id = ? AND platform = 'youtube' AND provider_status = 'published'
     ORDER BY event_at DESC
     LIMIT ?`,
  ).bind(workspaceId, connection.id, MAX_YOUTUBE_VIDEOS).all<{ external_id: string }>();
  let persisted = 0;

  await mapInBatches(videos.results, async ({ external_id: videoId }) => {
    const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('videoId', videoId);
    url.searchParams.set('maxResults', '100');
    url.searchParams.set('order', 'time');
    url.searchParams.set('textFormat', 'plainText');
    let response = await providerGet(fetchImpl, url.toString(), accessToken);
    if (response.status === 401) {
      accessToken = await refreshYouTubeAccessToken(db, env, workspaceId, connection.id, fetchImpl);
      response = await providerGet(fetchImpl, url.toString(), accessToken);
    }
    if (response.status === 403 || response.status === 404) return;
    if (!response.ok) throw new Error(`YouTube comments request failed (${response.status}).`);
    const payload = await readJson(response) as { items?: unknown };
    const threads = Array.isArray(payload.items) ? payload.items as YouTubeCommentThread[] : [];
    for (const event of normalizeYouTubeCommentThreads(connection, workspaceId, threads)) {
      const result = await persistSocialEvent(db, event);
      if (result === 'created') persisted += 1;
    }
  });
  return persisted;
}

export async function syncWorkspaceProviderComments(
  db: D1Database,
  env: Env,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ synced: number; skipped: number; failed: number; comments: number }> {
  const connections = await db.prepare(
    `SELECT id, platform, display_name
     FROM social_connections
     WHERE workspace_id = ? AND status = 'connected' AND platform IN ('instagram', 'youtube')
     ORDER BY platform, display_name`,
  ).bind(workspaceId).all<ConnectionRow>();

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let comments = 0;
  for (const connection of connections.results) {
    if (!await syncAllowed(db, workspaceId, connection.id, connection.platform)) {
      skipped += 1;
      continue;
    }
    await markAttempt(db, workspaceId, connection.id, connection.platform);
    try {
      const count = connection.platform === 'instagram'
        ? await syncInstagramComments(db, env, workspaceId, connection, fetchImpl)
        : await syncYouTubeComments(db, env, workspaceId, connection, fetchImpl);
      comments += count;
      synced += 1;
      await markSuccess(db, workspaceId, connection.id, connection.platform);
    } catch (error) {
      failed += 1;
      await markFailure(db, workspaceId, connection.id, connection.platform, error);
      console.warn(JSON.stringify({
        event: 'provider_inbox_comment_sync_failed',
        workspaceId,
        connectionId: connection.id,
        platform: connection.platform,
        message: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
      }));
    }
  }
  return { synced, skipped, failed, comments };
}
