import { decryptToken, tokenKeyringSecret } from './token-vault';

export type LinkedInPublicationEnvelope = {
  kind: 'linkedin_publication_sync';
  workspaceId: string;
  postId: string;
};

type LinkedInDestinationRow = {
  post_id: string;
  workspace_id: string;
  post_status: string;
  scheduled_at: string;
  body: string;
  media_reference: string | null;
  connection_id: string;
  destination_status: string;
  fields_json: string;
  person_id: string;
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

type RegisterUploadPayload = {
  value?: {
    uploadMechanism?: {
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: {
        uploadUrl?: unknown;
      };
    };
    asset?: unknown;
  };
};

export class LinkedInPublishingError extends Error {
  constructor(message: string, public readonly retryable = false) {
    super(message);
    this.name = 'LinkedInPublishingError';
  }
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

function publicationText(row: LinkedInDestinationRow): string {
  const fields = parseFields(row.fields_json);
  const explicit = typeof fields.commentary === 'string' ? fields.commentary.trim() : '';
  return explicit || row.body.trim();
}

function publicationVisibility(row: LinkedInDestinationRow): 'PUBLIC' | 'CONNECTIONS' {
  const fields = parseFields(row.fields_json);
  return fields.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC';
}

function publicationAltText(row: LinkedInDestinationRow): string {
  const fields = parseFields(row.fields_json);
  return typeof fields.altText === 'string' ? fields.altText.trim().slice(0, 4000) : '';
}

function mediaId(reference: string | null): string | undefined {
  return reference?.startsWith('library:') ? reference.slice('library:'.length) : undefined;
}

function personUrn(personId: string) {
  return personId.startsWith('urn:li:person:') ? personId : `urn:li:person:${personId}`;
}

function retryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function linkedinJsonRequest(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  init: RequestInit,
): Promise<{ response: Response; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'X-Restli-Protocol-Version': '2.0.0',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const body = await response.text().catch(() => '');
    if (!response.ok) {
      let detail = body.slice(0, 600);
      try {
        const parsed = JSON.parse(body) as { message?: unknown; serviceErrorCode?: unknown; status?: unknown };
        if (typeof parsed.message === 'string') detail = parsed.message;
      } catch {
        // Keep provider body.
      }
      throw new LinkedInPublishingError(
        `LinkedIn a refusé la publication (${response.status})${detail ? ` : ${detail}` : ''}`.slice(0, 1000),
        retryableStatus(response.status),
      );
    }
    if (!body) return { response, json: {} };
    try {
      return { response, json: JSON.parse(body) as Record<string, unknown> };
    } catch {
      return { response, json: {} };
    }
  } catch (error) {
    if (error instanceof LinkedInPublishingError) throw error;
    throw new LinkedInPublishingError('La requête LinkedIn n’a pas pu aboutir.', true);
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadBinary(
  fetchImpl: typeof fetch,
  uploadUrl: string,
  token: string,
  bytes: ArrayBuffer,
  mimeType: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': mimeType,
      },
      body: bytes,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw new LinkedInPublishingError(
        `LinkedIn a refusé l’envoi de l’image (${response.status})${detail ? ` : ${detail}` : ''}`.slice(0, 1000),
        retryableStatus(response.status),
      );
    }
  } catch (error) {
    if (error instanceof LinkedInPublishingError) throw error;
    throw new LinkedInPublishingError('L’image LinkedIn n’a pas pu être envoyée.', true);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadDestination(db: D1Database, workspaceId: string, postId: string): Promise<LinkedInDestinationRow | undefined> {
  const row = await db.prepare(
    `SELECT p.id AS post_id, p.workspace_id, p.status AS post_status, p.scheduled_at, p.body, p.media_reference,
            d.connection_id, d.status AS destination_status, d.fields_json,
            lc.external_account_id AS person_id, lc.status AS connection_status, lc.scopes_json,
            lc.access_token_ciphertext, lc.access_token_iv, lc.access_key_version
     FROM content_posts p
     JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id
     JOIN linkedin_connections lc ON lc.id = d.connection_id AND lc.workspace_id = d.workspace_id
     WHERE p.workspace_id = ? AND p.id = ? AND d.platform = 'linkedin' AND d.connection_id IS NOT NULL
     LIMIT 1`,
  ).bind(workspaceId, postId).first<LinkedInDestinationRow>();
  return row ?? undefined;
}

async function ensureSyncRow(db: D1Database, row: LinkedInDestinationRow, status: string) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO publication_remote_sync
       (id, workspace_id, post_id, connection_id, platform, sync_status, uploaded_bytes, attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'linkedin', ?, 0, 0, ?, ?)
     ON CONFLICT(workspace_id, post_id, connection_id, platform) DO UPDATE SET
       sync_status = CASE WHEN publication_remote_sync.external_id IS NOT NULL THEN publication_remote_sync.sync_status ELSE excluded.sync_status END,
       last_error = CASE WHEN publication_remote_sync.external_id IS NOT NULL THEN publication_remote_sync.last_error ELSE NULL END,
       updated_at = excluded.updated_at`,
  ).bind(`linkedin:${row.post_id}:${row.connection_id}`, row.workspace_id, row.post_id, row.connection_id, status, now, now).run();
}

export function linkedinPublishingConfigured(env: Env): boolean {
  return Boolean(tokenKeyringSecret(env));
}

export function isLinkedInPublicationEnvelope(value: unknown): value is LinkedInPublicationEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LinkedInPublicationEnvelope>;
  return candidate.kind === 'linkedin_publication_sync'
    && typeof candidate.workspaceId === 'string'
    && typeof candidate.postId === 'string';
}

export async function enqueueLinkedInPublicationSync(env: Env, workspaceId: string, postId: string): Promise<boolean> {
  if (!linkedinPublishingConfigured(env)) return false;
  const row = await loadDestination(env.DB, workspaceId, postId);
  if (!row) return false;
  if (row.post_status === 'cancelled') {
    await ensureSyncRow(env.DB, row, 'cancelled');
    return false;
  }
  await ensureSyncRow(env.DB, row, 'queued');
  const dueAt = Date.parse(row.scheduled_at);
  if (!Number.isFinite(dueAt) || dueAt > Date.now() + 60_000) return false;
  await env.EVENTS_QUEUE.send({ kind: 'linkedin_publication_sync', workspaceId, postId } satisfies LinkedInPublicationEnvelope, { contentType: 'json' });
  return true;
}

export async function enqueuePendingLinkedInPublicationSyncs(env: Env, limit = 20): Promise<number> {
  if (!linkedinPublishingConfigured(env)) return 0;
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `SELECT DISTINCT p.workspace_id, p.id AS post_id
     FROM content_posts p
     JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id
     JOIN linkedin_connections lc ON lc.id = d.connection_id AND lc.workspace_id = d.workspace_id
     LEFT JOIN publication_remote_sync rs
       ON rs.workspace_id = p.workspace_id AND rs.post_id = p.id
       AND rs.connection_id = d.connection_id AND rs.platform = 'linkedin'
     WHERE p.status = 'scheduled'
       AND p.scheduled_at <= ?
       AND d.platform = 'linkedin' AND d.connection_id IS NOT NULL
       AND d.status != 'cancelled' AND lc.status = 'connected'
       AND (rs.id IS NULL OR rs.sync_status = 'queued')
     ORDER BY p.scheduled_at ASC
     LIMIT ?`,
  ).bind(now, Math.max(1, Math.min(100, limit))).all<{ workspace_id: string; post_id: string }>();

  if (!result.results.length) return 0;
  await env.EVENTS_QUEUE.sendBatch(result.results.map((candidate) => ({
    body: { kind: 'linkedin_publication_sync', workspaceId: candidate.workspace_id, postId: candidate.post_id } satisfies LinkedInPublicationEnvelope,
    contentType: 'json' as const,
  })));
  return result.results.length;
}

async function registerImage(
  fetchImpl: typeof fetch,
  token: string,
  owner: string,
): Promise<{ uploadUrl: string; asset: string }> {
  const { json } = await linkedinJsonRequest(fetchImpl, 'https://api.linkedin.com/v2/assets?action=registerUpload', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner,
        serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
      },
    }),
  });
  const payload = json as RegisterUploadPayload;
  const uploadUrl = payload.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  const asset = payload.value?.asset;
  if (typeof uploadUrl !== 'string' || !uploadUrl.startsWith('https://') || typeof asset !== 'string' || !asset.startsWith('urn:li:')) {
    throw new LinkedInPublishingError('LinkedIn n’a pas retourné les informations nécessaires pour envoyer l’image.', true);
  }
  return { uploadUrl, asset };
}

export async function processLinkedInPublicationSync(
  env: Env,
  envelope: LinkedInPublicationEnvelope,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: 'published' | 'queued' | 'cancelled'; externalId?: string }> {
  const row = await loadDestination(env.DB, envelope.workspaceId, envelope.postId);
  if (!row) throw new LinkedInPublishingError('La destination LinkedIn n’existe plus.', false);

  const existing = await env.DB.prepare(
    `SELECT external_id, sync_status FROM publication_remote_sync
     WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'linkedin' LIMIT 1`,
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
  if (row.connection_status !== 'connected') {
    throw new LinkedInPublishingError('Reconnectez le profil LinkedIn avant de publier.', false);
  }
  const scopes = parseScopes(row.scopes_json);
  if (!scopes.includes('w_member_social')) {
    throw new LinkedInPublishingError('Reconnectez LinkedIn afin d’autoriser la publication (w_member_social).', false);
  }

  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new LinkedInPublishingError('La configuration de chiffrement LinkedIn est indisponible.', false);
  const token = await decryptToken(keyring, {
    ciphertext: row.access_token_ciphertext,
    iv: row.access_token_iv,
    keyVersion: row.access_key_version,
  }, {
    workspaceId: row.workspace_id,
    connectionId: row.connection_id,
    provider: 'linkedin',
    kind: 'access',
  });

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE publication_remote_sync
     SET sync_status = 'syncing', attempt_count = attempt_count + 1, last_error = NULL, updated_at = ?
     WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'linkedin'`,
  ).bind(now, row.workspace_id, row.post_id, row.connection_id).run();
  await env.DB.prepare(
    `UPDATE content_post_destinations SET status = 'publishing', updated_at = ?
     WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'linkedin'`,
  ).bind(now, row.workspace_id, row.post_id, row.connection_id).run();

  try {
    const commentary = publicationText(row);
    const owner = personUrn(row.person_id);
    const selectedMediaId = mediaId(row.media_reference);
    let media: Array<Record<string, unknown>> | undefined;
    let mediaCategory = 'NONE';

    if (selectedMediaId) {
      const item = await env.DB.prepare(
        `SELECT id, r2_key, file_name, mime_type, size_bytes FROM media_library WHERE id = ? AND workspace_id = ?`,
      ).bind(selectedMediaId, row.workspace_id).first<MediaRow>();
      if (!item) throw new LinkedInPublishingError('Le média LinkedIn sélectionné est introuvable.', false);
      if (!item.mime_type.startsWith('image/')) {
        throw new LinkedInPublishingError('La publication LinkedIn automatique prend actuellement en charge le texte et les images. Utilisez une image pour cette destination.', false);
      }
      if (item.size_bytes > 30 * 1024 * 1024) {
        throw new LinkedInPublishingError('L’image LinkedIn dépasse la limite de sécurité de 30 Mo.', false);
      }
      const object = await env.MEDIA_BUCKET.get(item.r2_key);
      if (!object) throw new LinkedInPublishingError('Le fichier média LinkedIn est introuvable dans le stockage.', false);
      const registered = await registerImage(fetchImpl, token, owner);
      await uploadBinary(fetchImpl, registered.uploadUrl, token, await object.arrayBuffer(), item.mime_type);
      mediaCategory = 'IMAGE';
      const altText = publicationAltText(row);
      media = [{
        status: 'READY',
        media: registered.asset,
        title: { text: item.file_name.slice(0, 200) },
        ...(altText ? { description: { text: altText } } : {}),
      }];
    }

    if (!commentary && !media) {
      throw new LinkedInPublishingError('Ajoutez du texte ou une image avant de publier sur LinkedIn.', false);
    }

    const specificContent: Record<string, unknown> = {
      shareCommentary: { text: commentary },
      shareMediaCategory: mediaCategory,
    };
    if (media) specificContent.media = media;

    const { response } = await linkedinJsonRequest(fetchImpl, 'https://api.linkedin.com/v2/ugcPosts', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        author: owner,
        lifecycleState: 'PUBLISHED',
        specificContent: { 'com.linkedin.ugc.ShareContent': specificContent },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': publicationVisibility(row) },
      }),
    });

    const externalId = response.headers.get('x-restli-id') ?? response.headers.get('X-RestLi-Id') ?? '';
    if (!externalId) throw new LinkedInPublishingError('LinkedIn a publié le contenu sans retourner son identifiant.', true);
    const externalUrl = externalId.startsWith('urn:li:') ? `https://www.linkedin.com/feed/update/${externalId}/` : undefined;
    const syncedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE publication_remote_sync
         SET external_id = ?, external_url = ?, sync_status = 'published', last_error = NULL, synced_at = ?, updated_at = ?
         WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'linkedin'`,
      ).bind(externalId, externalUrl ?? null, syncedAt, syncedAt, row.workspace_id, row.post_id, row.connection_id),
      env.DB.prepare(
        `UPDATE content_post_destinations SET status = 'published', updated_at = ?
         WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'linkedin'`,
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
    const normalized = error instanceof LinkedInPublishingError
      ? error
      : new LinkedInPublishingError(error instanceof Error ? error.message : 'Échec de publication LinkedIn.', true);
    const failedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE publication_remote_sync SET sync_status = 'failed', last_error = ?, updated_at = ?
         WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'linkedin'`,
      ).bind(normalized.message.slice(0, 1000), failedAt, row.workspace_id, row.post_id, row.connection_id),
      env.DB.prepare(
        `UPDATE content_post_destinations SET status = 'failed', updated_at = ?
         WHERE workspace_id = ? AND post_id = ? AND connection_id = ? AND platform = 'linkedin'`,
      ).bind(failedAt, row.workspace_id, row.post_id, row.connection_id),
    ]);
    throw normalized;
  }
}
