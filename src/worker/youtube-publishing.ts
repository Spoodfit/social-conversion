import { getMediaLibraryItem } from './media-library';
import { loadOAuthTokens, saveOAuthCredentials, tokenKeyringSecret } from './token-vault';

export type YouTubeSyncEnvelope = {
  kind: 'youtube_publication_sync';
  workspaceId: string;
  postId: string;
};

type YoutubeDestinationRow = {
  post_id: string;
  workspace_id: string;
  post_status: string;
  scheduled_at: string;
  media_reference: string | null;
  connection_id: string;
  destination_status: string;
  format: string;
  fields_json: string | null;
  connection_status: string;
};

type RemoteSyncRow = {
  id: string;
  workspace_id: string;
  post_id: string;
  connection_id: string;
  platform: string;
  external_id: string | null;
  external_url: string | null;
  upload_url: string | null;
  media_id: string | null;
  sync_status: string;
  uploaded_bytes: number;
  attempt_count: number;
  last_error: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type YoutubeMetadata = {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
  };
  status: {
    privacyStatus: 'private' | 'public' | 'unlisted';
    publishAt?: string;
    embeddable: boolean;
    license: 'youtube';
    publicStatsViewable: boolean;
    selfDeclaredMadeForKids: boolean;
    containsSyntheticMedia: boolean;
  };
};

export class YouTubePublishingError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'YouTubePublishingError';
  }
}

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function youtubePublishingConfigured(env: Env): boolean {
  return Boolean(
    tokenKeyringSecret(env)
    && envString(env, 'YOUTUBE_CLIENT_ID')
    && envString(env, 'YOUTUBE_CLIENT_SECRET'),
  );
}

export function isYouTubeSyncEnvelope(value: unknown): value is YouTubeSyncEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<YouTubeSyncEnvelope>;
  return candidate.kind === 'youtube_publication_sync'
    && typeof candidate.workspaceId === 'string'
    && typeof candidate.postId === 'string';
}

function parseFields(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function tags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 100);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 100);
  }
  return [];
}

export function buildYouTubeMetadata(
  fields: Record<string, unknown>,
  scheduledAt: string,
  nowMs = Date.now(),
): YoutubeMetadata {
  const title = text(fields.title).slice(0, 100);
  if (!title) throw new YouTubePublishingError('Le titre YouTube est requis avant synchronisation.');

  const requestedPrivacy = text(fields.privacyStatus);
  const privacyStatus: 'private' | 'public' | 'unlisted' = requestedPrivacy === 'public' || requestedPrivacy === 'unlisted'
    ? requestedPrivacy
    : 'private';
  const scheduled = new Date(scheduledAt);
  if (Number.isNaN(scheduled.getTime())) throw new YouTubePublishingError('La date de programmation YouTube est invalide.');

  const future = scheduled.getTime() > nowMs + 30_000;
  const shouldSchedulePublic = future && privacyStatus === 'public';
  const status: YoutubeMetadata['status'] = {
    privacyStatus: shouldSchedulePublic ? 'private' : privacyStatus,
    embeddable: boolean(fields.embeddable, true),
    license: 'youtube',
    publicStatsViewable: true,
    selfDeclaredMadeForKids: boolean(fields.madeForKids),
    containsSyntheticMedia: boolean(fields.containsSyntheticMedia),
  };
  if (shouldSchedulePublic) status.publishAt = scheduled.toISOString();

  return {
    snippet: {
      title,
      description: text(fields.description).slice(0, 5_000),
      tags: tags(fields.tags),
      categoryId: text(fields.categoryId) || '22',
    },
    status,
  };
}

async function markQueuedRows(db: D1Database, workspaceId: string, postId: string) {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE publication_remote_sync
     SET sync_status = 'queued', last_error = NULL, updated_at = ?
     WHERE workspace_id = ? AND post_id = ? AND platform = 'youtube'`,
  ).bind(now, workspaceId, postId).run();

  const current = await db.prepare(
    `SELECT DISTINCT d.connection_id
     FROM content_post_destinations d
     JOIN social_connections sc ON sc.id = d.connection_id AND sc.workspace_id = d.workspace_id
     WHERE d.workspace_id = ? AND d.post_id = ? AND d.platform = 'youtube'
       AND d.connection_id IS NOT NULL AND sc.status = 'connected'`,
  ).bind(workspaceId, postId).all<{ connection_id: string }>();

  for (const row of current.results) {
    await db.prepare(
      `INSERT INTO publication_remote_sync
        (id, workspace_id, post_id, connection_id, platform, sync_status, uploaded_bytes, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'youtube', 'queued', 0, 0, ?, ?)
       ON CONFLICT(workspace_id, post_id, connection_id, platform) DO UPDATE SET
         sync_status = 'queued', last_error = NULL, updated_at = excluded.updated_at`,
    ).bind(crypto.randomUUID(), workspaceId, postId, row.connection_id, now, now).run();
  }
}

export async function enqueueYouTubePublicationSync(env: Env, workspaceId: string, postId: string): Promise<boolean> {
  if (!youtubePublishingConfigured(env)) return false;
  await markQueuedRows(env.DB, workspaceId, postId);
  const hasWork = await env.DB.prepare(
    `SELECT 1 AS present FROM publication_remote_sync
     WHERE workspace_id = ? AND post_id = ? AND platform = 'youtube' LIMIT 1`,
  ).bind(workspaceId, postId).first<{ present: number }>();
  if (!hasWork) return false;
  await env.EVENTS_QUEUE.send({ kind: 'youtube_publication_sync', workspaceId, postId } satisfies YouTubeSyncEnvelope, { contentType: 'json' });
  return true;
}

export async function enqueuePendingYouTubePublicationSyncs(env: Env, limit = 20): Promise<number> {
  if (!youtubePublishingConfigured(env)) return 0;
  const stale = new Date(Date.now() - 15 * 60_000).toISOString();
  const now = new Date().toISOString();
  const candidates = await env.DB.prepare(
    `SELECT DISTINCT p.workspace_id, p.id AS post_id
     FROM content_posts p
     JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id
     JOIN social_connections sc ON sc.id = d.connection_id AND sc.workspace_id = d.workspace_id
     LEFT JOIN publication_remote_sync rs
       ON rs.workspace_id = p.workspace_id AND rs.post_id = p.id
       AND rs.connection_id = d.connection_id AND rs.platform = 'youtube'
     WHERE p.status = 'scheduled' AND p.scheduled_at > ?
       AND d.platform = 'youtube' AND d.connection_id IS NOT NULL
       AND d.status != 'cancelled' AND sc.status = 'connected'
       AND (rs.id IS NULL OR rs.sync_status = 'queued' OR (rs.sync_status = 'syncing' AND rs.updated_at < ?))
     ORDER BY p.scheduled_at ASC
     LIMIT ?`,
  ).bind(now, stale, Math.max(1, Math.min(100, limit))).all<{ workspace_id: string; post_id: string }>();

  for (const candidate of candidates.results) {
    await markQueuedRows(env.DB, candidate.workspace_id, candidate.post_id);
    await env.EVENTS_QUEUE.send({
      kind: 'youtube_publication_sync',
      workspaceId: candidate.workspace_id,
      postId: candidate.post_id,
    } satisfies YouTubeSyncEnvelope, { contentType: 'json' });
  }
  return candidates.results.length;
}

async function freshAccessToken(db: D1Database, env: Env, workspaceId: string, connectionId: string, forceRefresh = false): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  const clientId = envString(env, 'YOUTUBE_CLIENT_ID');
  const clientSecret = envString(env, 'YOUTUBE_CLIENT_SECRET');
  if (!keyring || !clientId || !clientSecret) throw new YouTubePublishingError('La publication YouTube n’est pas configurée.');

  let tokens = await loadOAuthTokens(db, keyring, workspaceId, connectionId);
  if (!tokens || tokens.credentials.provider !== 'youtube') throw new YouTubePublishingError('Les autorisations YouTube sont introuvables. Reconnectez le compte.');
  if (!tokens.credentials.scopes.includes('https://www.googleapis.com/auth/youtube.upload')) {
    throw new YouTubePublishingError('Le compte YouTube ne possède pas l’autorisation de publier. Reconnectez-le.');
  }

  const expiresAt = tokens.credentials.accessExpiresAt ? Date.parse(tokens.credentials.accessExpiresAt) : Number.POSITIVE_INFINITY;
  if (!forceRefresh && expiresAt > Date.now() + 2 * 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new YouTubePublishingError('Le jeton YouTube a expiré et ne peut pas être renouvelé. Reconnectez le compte.');

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!response.ok) throw new YouTubePublishingError(`Le renouvellement YouTube a échoué (${response.status}).`, response.status >= 500 || response.status === 429, response.status);
  const payload = await response.json() as { access_token?: unknown; expires_in?: unknown; scope?: unknown };
  if (typeof payload.access_token !== 'string' || !payload.access_token) throw new YouTubePublishingError('Google n’a pas renvoyé de nouveau jeton YouTube.');
  const accessExpiresAt = new Date(Date.now() + (Number(payload.expires_in) || 3600) * 1000).toISOString();
  await saveOAuthCredentials(db, keyring, {
    workspaceId,
    connectionId,
    provider: 'youtube',
    accessToken: payload.access_token,
    scopes: tokens.credentials.scopes,
    accessExpiresAt,
  });
  tokens = await loadOAuthTokens(db, keyring, workspaceId, connectionId);
  return tokens?.accessToken ?? payload.access_token;
}

async function providerRequest(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connectionId: string,
  url: string,
  init: RequestInit,
  retryAuth = true,
): Promise<Response> {
  const accessToken = await freshAccessToken(db, env, workspaceId, connectionId);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${accessToken}`);
  let response = await fetch(url, { ...init, headers });
  if (response.status === 401 && retryAuth) {
    const refreshed = await freshAccessToken(db, env, workspaceId, connectionId, true);
    headers.set('authorization', `Bearer ${refreshed}`);
    response = await fetch(url, { ...init, headers });
  }
  return response;
}

async function providerError(response: Response, prefix: string): Promise<YouTubePublishingError> {
  let detail = '';
  try {
    const payload = await response.clone().json() as { error?: { message?: unknown } };
    detail = typeof payload.error?.message === 'string' ? payload.error.message : '';
  } catch {
    detail = '';
  }
  const message = `${prefix} (${response.status})${detail ? ` : ${detail}` : ''}`;
  return new YouTubePublishingError(message.slice(0, 1_000), response.status === 408 || response.status === 429 || response.status >= 500, response.status);
}

async function loadDestinations(db: D1Database, workspaceId: string, postId: string) {
  const result = await db.prepare(
    `SELECT p.id AS post_id, p.workspace_id, p.status AS post_status, p.scheduled_at, p.media_reference,
            d.connection_id, d.status AS destination_status, d.format, d.fields_json,
            sc.status AS connection_status
     FROM content_posts p
     JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id
     JOIN social_connections sc ON sc.id = d.connection_id AND sc.workspace_id = d.workspace_id
     WHERE p.workspace_id = ? AND p.id = ? AND d.platform = 'youtube' AND d.connection_id IS NOT NULL`,
  ).bind(workspaceId, postId).all<YoutubeDestinationRow>();
  return result.results;
}

async function loadRemoteRows(db: D1Database, workspaceId: string, postId: string) {
  const result = await db.prepare(
    `SELECT id, workspace_id, post_id, connection_id, platform, external_id, external_url, upload_url,
            media_id, sync_status, uploaded_bytes, attempt_count, last_error, synced_at, created_at, updated_at
     FROM publication_remote_sync
     WHERE workspace_id = ? AND post_id = ? AND platform = 'youtube'`,
  ).bind(workspaceId, postId).all<RemoteSyncRow>();
  return result.results;
}

async function upsertRemoteRow(db: D1Database, destination: YoutubeDestinationRow): Promise<RemoteSyncRow> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO publication_remote_sync
      (id, workspace_id, post_id, connection_id, platform, sync_status, uploaded_bytes, attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'youtube', 'syncing', 0, 1, ?, ?)
     ON CONFLICT(workspace_id, post_id, connection_id, platform) DO UPDATE SET
       sync_status = 'syncing', attempt_count = publication_remote_sync.attempt_count + 1,
       last_error = NULL, updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), destination.workspace_id, destination.post_id, destination.connection_id, now, now).run();
  const row = await db.prepare(
    `SELECT id, workspace_id, post_id, connection_id, platform, external_id, external_url, upload_url,
            media_id, sync_status, uploaded_bytes, attempt_count, last_error, synced_at, created_at, updated_at
     FROM publication_remote_sync
     WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'youtube'`,
  ).bind(destination.workspace_id, destination.post_id, destination.connection_id).first<RemoteSyncRow>();
  if (!row) throw new YouTubePublishingError('L’état de synchronisation YouTube n’a pas pu être créé.', true);
  return row;
}

async function setRemoteFailure(db: D1Database, row: RemoteSyncRow, error: unknown) {
  const message = error instanceof Error ? error.message : 'Erreur YouTube inconnue.';
  await db.prepare(
    `UPDATE publication_remote_sync SET sync_status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`,
  ).bind(message.slice(0, 1_000), new Date().toISOString(), row.id).run();
}

async function deleteRemoteVideo(db: D1Database, env: Env, row: RemoteSyncRow) {
  if (row.external_id) {
    const response = await providerRequest(
      db,
      env,
      row.workspace_id,
      row.connection_id,
      `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(row.external_id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok && response.status !== 404) throw await providerError(response, 'La suppression YouTube a échoué');
  }
  await db.prepare(
    `UPDATE publication_remote_sync
     SET external_id = NULL, external_url = NULL, upload_url = NULL, uploaded_bytes = 0,
         sync_status = 'cancelled', last_error = NULL, synced_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(new Date().toISOString(), new Date().toISOString(), row.id).run();
}

async function startResumableUpload(
  db: D1Database,
  env: Env,
  destination: YoutubeDestinationRow,
  row: RemoteSyncRow,
  metadata: YoutubeMetadata,
  mimeType: string,
  sizeBytes: number,
): Promise<string> {
  const response = await providerRequest(
    db,
    env,
    destination.workspace_id,
    destination.connection_id,
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(sizeBytes),
        'x-upload-content-type': mimeType,
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!response.ok) throw await providerError(response, 'YouTube a refusé de préparer l’upload');
  const uploadUrl = response.headers.get('location');
  if (!uploadUrl) throw new YouTubePublishingError('YouTube n’a pas renvoyé d’URL d’upload.', true);
  await db.prepare(
    `UPDATE publication_remote_sync SET upload_url = ?, uploaded_bytes = 0, updated_at = ? WHERE id = ?`,
  ).bind(uploadUrl, new Date().toISOString(), row.id).run();
  return uploadUrl;
}

function completedVideoId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const id = (payload as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : undefined;
}

async function probeUpload(
  db: D1Database,
  env: Env,
  destination: YoutubeDestinationRow,
  uploadUrl: string,
  sizeBytes: number,
): Promise<{ offset: number; videoId?: string; expired?: boolean }> {
  const response = await providerRequest(db, env, destination.workspace_id, destination.connection_id, uploadUrl, {
    method: 'PUT',
    headers: {
      'content-length': '0',
      'content-range': `bytes */${sizeBytes}`,
    },
  });
  if (response.status === 404 || response.status === 410) return { offset: 0, expired: true };
  if (response.status === 308) {
    const range = response.headers.get('range');
    const match = range?.match(/bytes=0-(\d+)/i);
    return { offset: match ? Number(match[1]) + 1 : 0 };
  }
  if (response.ok) {
    const payload = await response.json().catch(() => undefined);
    const videoId = completedVideoId(payload);
    if (videoId) return { offset: sizeBytes, videoId };
  }
  throw await providerError(response, 'Impossible de reprendre l’upload YouTube');
}

async function uploadMedia(
  db: D1Database,
  env: Env,
  destination: YoutubeDestinationRow,
  row: RemoteSyncRow,
  metadata: YoutubeMetadata,
  mediaId: string,
  r2Key: string,
  mimeType: string,
  sizeBytes: number,
): Promise<string> {
  let uploadUrl = row.upload_url ?? undefined;
  let offset = Math.max(0, Math.min(sizeBytes, row.uploaded_bytes || 0));

  if (uploadUrl) {
    const probe = await probeUpload(db, env, destination, uploadUrl, sizeBytes);
    if (probe.videoId) return probe.videoId;
    if (probe.expired) {
      uploadUrl = undefined;
      offset = 0;
      await db.prepare(`UPDATE publication_remote_sync SET upload_url = NULL, uploaded_bytes = 0, updated_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), row.id).run();
    } else {
      offset = probe.offset;
    }
  }

  if (!uploadUrl) uploadUrl = await startResumableUpload(db, env, destination, row, metadata, mimeType, sizeBytes);

  const chunkSize = 8 * 1024 * 1024;
  while (offset < sizeBytes) {
    const length = Math.min(chunkSize, sizeBytes - offset);
    const object = await env.MEDIA_BUCKET.get(r2Key, { range: { offset, length } });
    if (!object?.body) throw new YouTubePublishingError('Le fichier média n’est plus disponible dans la bibliothèque.');
    const end = offset + length - 1;
    const response = await providerRequest(db, env, destination.workspace_id, destination.connection_id, uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': mimeType,
        'content-length': String(length),
        'content-range': `bytes ${offset}-${end}/${sizeBytes}`,
      },
      body: object.body,
    });
    if (response.status === 308) {
      const range = response.headers.get('range');
      const match = range?.match(/bytes=0-(\d+)/i);
      offset = match ? Number(match[1]) + 1 : end + 1;
      await db.prepare(
        `UPDATE publication_remote_sync SET uploaded_bytes = ?, media_id = ?, updated_at = ? WHERE id = ?`,
      ).bind(offset, mediaId, new Date().toISOString(), row.id).run();
      continue;
    }
    if (!response.ok) throw await providerError(response, 'L’upload YouTube a échoué');
    const payload = await response.json().catch(() => undefined);
    const videoId = completedVideoId(payload);
    if (!videoId) throw new YouTubePublishingError('YouTube a terminé l’upload sans renvoyer l’identifiant de la vidéo.', true);
    return videoId;
  }
  throw new YouTubePublishingError('L’upload YouTube est incomplet.', true);
}

async function updateRemoteVideo(
  db: D1Database,
  env: Env,
  destination: YoutubeDestinationRow,
  externalId: string,
  metadata: YoutubeMetadata,
) {
  const response = await providerRequest(
    db,
    env,
    destination.workspace_id,
    destination.connection_id,
    'https://www.googleapis.com/youtube/v3/videos?part=snippet%2Cstatus',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ id: externalId, ...metadata }),
    },
  );
  if (!response.ok) throw await providerError(response, 'La mise à jour YouTube a échoué');
}

async function syncDestination(db: D1Database, env: Env, destination: YoutubeDestinationRow) {
  let row = await upsertRemoteRow(db, destination);
  try {
    if (destination.post_status === 'cancelled' || destination.destination_status === 'cancelled') {
      await deleteRemoteVideo(db, env, row);
      return;
    }
    if (destination.connection_status !== 'connected') throw new YouTubePublishingError('Le compte YouTube doit être reconnecté avant publication.');
    if (!destination.media_reference?.startsWith('library:')) throw new YouTubePublishingError('Une vidéo de la bibliothèque est requise pour publier sur YouTube.');
    const mediaId = destination.media_reference.slice('library:'.length);
    const media = await getMediaLibraryItem(db, destination.workspace_id, mediaId);
    if (!media.item.mimeType.startsWith('video/')) throw new YouTubePublishingError('Le contenu sélectionné n’est pas une vidéo compatible avec YouTube.');
    const object = await env.MEDIA_BUCKET.head(media.row.r2_key);
    if (!object) throw new YouTubePublishingError('Le fichier vidéo n’existe plus dans le stockage.');

    const metadata = buildYouTubeMetadata(parseFields(destination.fields_json), destination.scheduled_at);
    if (row.external_id && row.media_id && row.media_id !== mediaId) {
      await deleteRemoteVideo(db, env, row);
      row = await upsertRemoteRow(db, destination);
    }

    let externalId = row.external_id ?? undefined;
    if (!externalId) {
      externalId = await uploadMedia(
        db,
        env,
        destination,
        row,
        metadata,
        mediaId,
        media.row.r2_key,
        media.item.mimeType,
        media.item.sizeBytes,
      );
    } else {
      await updateRemoteVideo(db, env, destination, externalId, metadata);
    }

    const syncStatus = metadata.status.publishAt ? 'scheduled' : 'uploaded';
    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE publication_remote_sync
       SET external_id = ?, external_url = ?, upload_url = NULL, media_id = ?, sync_status = ?,
           uploaded_bytes = ?, last_error = NULL, synced_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(externalId, `https://youtu.be/${externalId}`, mediaId, syncStatus, media.item.sizeBytes, now, now, row.id).run();
  } catch (error) {
    await setRemoteFailure(db, row, error);
    throw error;
  }
}

export async function processYouTubePublicationSync(env: Env, envelope: YouTubeSyncEnvelope): Promise<{ synced: number; deleted: number }> {
  if (!youtubePublishingConfigured(env)) throw new YouTubePublishingError('La publication YouTube n’est pas configurée.');
  const destinations = await loadDestinations(env.DB, envelope.workspaceId, envelope.postId);
  const remoteRows = await loadRemoteRows(env.DB, envelope.workspaceId, envelope.postId);
  const currentConnections = new Set(destinations.map((destination) => destination.connection_id));
  let deleted = 0;
  let synced = 0;

  for (const row of remoteRows) {
    const current = destinations.find((destination) => destination.connection_id === row.connection_id);
    if (!current || current.post_status === 'cancelled' || current.destination_status === 'cancelled') {
      try {
        await deleteRemoteVideo(env.DB, env, row);
        deleted += 1;
      } catch (error) {
        await setRemoteFailure(env.DB, row, error);
        throw error;
      }
    }
  }

  for (const destination of destinations) {
    if (!currentConnections.has(destination.connection_id)) continue;
    if (destination.post_status === 'cancelled' || destination.destination_status === 'cancelled') continue;
    await syncDestination(env.DB, env, destination);
    synced += 1;
  }

  return { synced, deleted };
}
