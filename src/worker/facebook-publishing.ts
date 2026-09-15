import { decryptToken, tokenKeyringSecret } from './token-vault';

export type FacebookPublicationEnvelope = {
  kind: 'facebook_publication_sync';
  workspaceId: string;
  postId: string;
};

type FacebookDestinationRow = {
  post_id: string;
  workspace_id: string;
  post_status: string;
  scheduled_at: string;
  body: string;
  media_reference: string | null;
  connection_id: string;
  destination_status: string;
  fields_json: string;
  page_id: string;
  connection_status: string;
  scopes_json: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_key_version: string;
};

type MediaRow = {
  id: string;
  r2_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};

export class FacebookPublishingError extends Error {
  constructor(message: string, public readonly retryable = false) {
    super(message);
    this.name = 'FacebookPublishingError';
  }
}

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function graphVersion(env: Env) {
  const value = envString(env, 'META_GRAPH_VERSION');
  return value && /^v\d{1,3}\.\d{1,2}$/.test(value) ? value : 'v24.0';
}

function parseScopes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [];
  } catch {
    return [];
  }
}

function parseFields(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function publicationText(row: FacebookDestinationRow): string {
  const fields = parseFields(row.fields_json);
  const explicit = typeof fields.message === 'string' ? fields.message.trim() : '';
  return explicit || row.body.trim();
}

function mediaId(reference: string | null): string | undefined {
  return reference?.startsWith('library:') ? reference.slice('library:'.length) : undefined;
}

async function graphRequest(fetchImpl: typeof fetch, url: string, token: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const body = await response.text().catch(() => '');
    if (!response.ok) {
      let detail = body.slice(0, 500);
      try {
        const parsed = JSON.parse(body) as { error?: { message?: unknown; code?: unknown } };
        const message = typeof parsed.error?.message === 'string' ? parsed.error.message : '';
        const code = typeof parsed.error?.code === 'number' ? ` (${parsed.error.code})` : '';
        if (message) detail = `${message}${code}`;
      } catch {
        // Keep the truncated provider body.
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new FacebookPublishingError(`Facebook a refusé la publication (${response.status})${detail ? ` : ${detail}` : ''}`.slice(0, 1000), retryable);
    }
    if (!body) return {} as Record<string, unknown>;
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function loadDestination(db: D1Database, workspaceId: string, postId: string): Promise<FacebookDestinationRow | undefined> {
  return db.prepare(
    `SELECT p.id AS post_id, p.workspace_id, p.status AS post_status, p.scheduled_at, p.body, p.media_reference,
            d.connection_id, d.status AS destination_status, d.fields_json,
            fc.external_account_id AS page_id, fc.status AS connection_status, fc.scopes_json,
            fc.access_token_ciphertext, fc.access_token_iv, fc.access_key_version
     FROM content_posts p
     JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id
     JOIN facebook_connections fc ON fc.id = d.connection_id AND fc.workspace_id = d.workspace_id
     WHERE p.workspace_id = ? AND p.id = ? AND d.platform = 'facebook' AND d.connection_id IS NOT NULL
     LIMIT 1`,
  ).bind(workspaceId, postId).first<FacebookDestinationRow>() ?? undefined;
}

async function ensureSyncRow(db: D1Database, row: FacebookDestinationRow, status: string) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO publication_remote_sync
       (id, workspace_id, post_id, connection_id, platform, sync_status, uploaded_bytes, attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'facebook', ?, 0, 0, ?, ?)
     ON CONFLICT(workspace_id, post_id, connection_id, platform) DO UPDATE SET
       sync_status = CASE WHEN publication_remote_sync.external_id IS NOT NULL THEN publication_remote_sync.sync_status ELSE excluded.sync_status END,
       last_error = CASE WHEN publication_remote_sync.external_id IS NOT NULL THEN publication_remote_sync.last_error ELSE NULL END,
       updated_at = excluded.updated_at`,
  ).bind(`facebook:${row.post_id}:${row.connection_id}`, row.workspace_id, row.post_id, row.connection_id, status, now, now).run();
}

export function facebookPublishingConfigured(env: Env): boolean {
  return Boolean(tokenKeyringSecret(env));
}

export function isFacebookPublicationEnvelope(value: unknown): value is FacebookPublicationEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FacebookPublicationEnvelope>;
  return candidate.kind === 'facebook_publication_sync'
    && typeof candidate.workspaceId === 'string'
    && typeof candidate.postId === 'string';
}

export async function enqueueFacebookPublicationSync(env: Env, workspaceId: string, postId: string): Promise<boolean> {
  if (!facebookPublishingConfigured(env)) return false;
  const row = await loadDestination(env.DB, workspaceId, postId);
  if (!row) return false;
  if (row.post_status === 'cancelled') {
    await ensureSyncRow(env.DB, row, 'cancelled');
    return false;
  }
  await ensureSyncRow(env.DB, row, 'queued');
  const dueAt = Date.parse(row.scheduled_at);
  if (!Number.isFinite(dueAt) || dueAt > Date.now() + 60_000) return false;
  await env.EVENTS_QUEUE.send({ kind: 'facebook_publication_sync', workspaceId, postId } satisfies FacebookPublicationEnvelope, { contentType: 'json' });
  return true;
}

export async function enqueuePendingFacebookPublicationSyncs(env: Env, limit = 20): Promise<number> {
  if (!facebookPublishingConfigured(env)) return 0;
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `SELECT DISTINCT p.workspace_id, p.id AS post_id
     FROM content_posts p
     JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id
     JOIN facebook_connections fc ON fc.id = d.connection_id AND fc.workspace_id = d.workspace_id
     LEFT JOIN publication_remote_sync rs
       ON rs.workspace_id = p.workspace_id AND rs.post_id = p.id
       AND rs.connection_id = d.connection_id AND rs.platform = 'facebook'
     WHERE p.status = 'scheduled'
       AND p.scheduled_at <= ?
       AND d.platform = 'facebook' AND d.connection_id IS NOT NULL
       AND d.status != 'cancelled' AND fc.status = 'connected'
       AND (rs.id IS NULL OR rs.sync_status = 'queued')
     ORDER BY p.scheduled_at ASC
     LIMIT ?`,
  ).bind(now, Math.max(1, Math.min(100, limit))).all<{ workspace_id: string; post_id: string }>();

  if (!result.results.length) return 0;
  await env.EVENTS_QUEUE.sendBatch(result.results.map((candidate) => ({
    body: { kind: 'facebook_publication_sync', workspaceId: candidate.workspace_id, postId: candidate.post_id } satisfies FacebookPublicationEnvelope,
    contentType: 'json' as const,
  })));
  return result.results.length;
}

async function publishedPermalink(env: Env, externalId: string, token: string, fetchImpl: typeof fetch): Promise<string | undefined> {
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(externalId)}`);
    url.searchParams.set('fields', 'permalink_url');
    const payload = await graphRequest(fetchImpl, url.toString(), token, { method: 'GET' });
    return typeof payload.permalink_url === 'string' && payload.permalink_url.startsWith('https://') ? payload.permalink_url : undefined;
  } catch {
    return undefined;
  }
}

export async function processFacebookPublicationSync(
  env: Env,
  envelope: FacebookPublicationEnvelope,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: 'published' | 'queued' | 'cancelled'; externalId?: string }> {
  const row = await loadDestination(env.DB, envelope.workspaceId, envelope.postId);
  if (!row) throw new FacebookPublishingError('La destination Facebook n’existe plus.', false);

  const existing = await env.DB.prepare(
    `SELECT external_id, sync_status FROM publication_remote_sync
     WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'facebook' LIMIT 1`,
  ).bind(row.workspace_id, row.post_id, row.connection_id).first<{ external_id: string | null; sync_status: string }>();
  if (existing?.external_id) return { status: 'published', externalId: existing.external_id };

  if (row.post_status === 'cancelled' || row.destination_status === 'cancelled') {
    await ensureSyncRow(env.DB, row, 'cancelled');
    return { status: 'cancelled' };
  }
  const dueAt = Date.parse(row.scheduled_at);
  if (Number.isFinite(dueAt) && dueAt > Date.now() + 15_000) {
    await ensureSyncRow(env.DB, row, 'queued');
    return { status: 'queued' };
  }
  if (row.connection_status !== 'connected') throw new FacebookPublishingError('Reconnectez la Page Facebook avant de publier.', false);
  const scopes = parseScopes(row.scopes_json);
  if (!scopes.includes('pages_manage_posts')) {
    throw new FacebookPublishingError('Reconnectez Facebook afin d’autoriser la publication sur la Page (pages_manage_posts).', false);
  }

  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new FacebookPublishingError('La configuration de chiffrement Facebook est indisponible.', false);
  const token = await decryptToken(keyring, {
    ciphertext: row.access_token_ciphertext,
    iv: row.access_token_iv,
    keyVersion: row.access_key_version,
  }, {
    workspaceId: row.workspace_id,
    connectionId: row.connection_id,
    provider: 'facebook',
    kind: 'access',
  });

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE publication_remote_sync
     SET sync_status = 'syncing', attempt_count = attempt_count + 1, last_error = NULL, updated_at = ?
     WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'facebook'`,
  ).bind(now, row.workspace_id, row.post_id, row.connection_id).run();
  await env.DB.prepare(
    `UPDATE content_post_destinations SET status = 'publishing', updated_at = ?
     WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'facebook'`,
  ).bind(now, row.workspace_id, row.post_id, row.connection_id).run();

  try {
    const message = publicationText(row);
    const selectedMediaId = mediaId(row.media_reference);
    let payload: Record<string, unknown>;
    if (selectedMediaId) {
      const media = await env.DB.prepare(
        `SELECT id, r2_key, file_name, mime_type, size_bytes FROM media_library WHERE id = ? AND workspace_id = ?`,
      ).bind(selectedMediaId, row.workspace_id).first<MediaRow>();
      if (!media) throw new FacebookPublishingError('Le média Facebook sélectionné est introuvable.', false);
      if (!media.mime_type.startsWith('image/')) {
        throw new FacebookPublishingError('La publication Facebook automatique prend actuellement en charge les images et le texte. Choisissez une image pour cette destination.', false);
      }
      if (media.size_bytes > 30 * 1024 * 1024) {
        throw new FacebookPublishingError('L’image Facebook dépasse la limite de sécurité de 30 Mo.', false);
      }
      const object = await env.MEDIA_BUCKET.get(media.r2_key);
      if (!object) throw new FacebookPublishingError('Le fichier média Facebook est introuvable dans le stockage.', false);
      const form = new FormData();
      form.set('published', 'true');
      if (message) form.set('caption', message);
      form.set('source', new File([await object.arrayBuffer()], media.file_name, { type: media.mime_type }));
      payload = await graphRequest(
        fetchImpl,
        `https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(row.page_id)}/photos`,
        token,
        { method: 'POST', body: form },
      );
    } else {
      const form = new URLSearchParams();
      form.set('message', message || 'Publication');
      payload = await graphRequest(
        fetchImpl,
        `https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(row.page_id)}/feed`,
        token,
        { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: form.toString() },
      );
    }

    const externalId = typeof payload.post_id === 'string'
      ? payload.post_id
      : typeof payload.id === 'string'
        ? payload.id
        : '';
    if (!externalId) throw new FacebookPublishingError('Facebook a publié le contenu sans retourner son identifiant.', true);
    const externalUrl = await publishedPermalink(env, externalId, token, fetchImpl);
    const syncedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE publication_remote_sync
         SET external_id = ?, external_url = ?, sync_status = 'published', last_error = NULL, synced_at = ?, updated_at = ?
         WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'facebook'`,
      ).bind(externalId, externalUrl ?? null, syncedAt, syncedAt, row.workspace_id, row.post_id, row.connection_id),
      env.DB.prepare(
        `UPDATE content_post_destinations SET status = 'published', updated_at = ?
         WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'facebook'`,
      ).bind(syncedAt, row.workspace_id, row.post_id, row.connection_id),
    ]);

    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM content_post_destinations
       WHERE workspace_id = ? AND post_id = ? AND status NOT IN ('published', 'cancelled')`,
    ).bind(row.workspace_id, row.post_id).first<{ count: number }>();
    if ((remaining?.count ?? 1) === 0) {
      await env.DB.prepare(
        `UPDATE content_posts SET status = 'completed', updated_at = ? WHERE workspace_id = ? AND id = ? AND status = 'scheduled'`,
      ).bind(syncedAt, row.workspace_id, row.post_id).run();
    }
    return { status: 'published', externalId };
  } catch (error) {
    const normalized = error instanceof FacebookPublishingError
      ? error
      : new FacebookPublishingError(error instanceof Error ? error.message : 'Échec de publication Facebook.', true);
    const failedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE publication_remote_sync SET sync_status = 'failed', last_error = ?, updated_at = ?
         WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'facebook'`,
      ).bind(normalized.message.slice(0, 1000), failedAt, row.workspace_id, row.post_id, row.connection_id),
      env.DB.prepare(
        `UPDATE content_post_destinations SET status = 'failed', updated_at = ?
         WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'facebook'`,
      ).bind(failedAt, row.workspace_id, row.post_id, row.connection_id),
    ]);
    throw normalized;
  }
}
