import type { WorkspacePrincipal } from './authorization';
import { listPublications, PublishingError } from './publishing';

type PublishingPlatform = 'instagram' | 'youtube' | 'tiktok';

type ConnectionRow = {
  id: string;
  platform: PublishingPlatform;
  display_name: string;
  status: string;
};

function normalizeBody(value: unknown) {
  const body = typeof value === 'string' ? value.trim() : '';
  if (!body || body.length > 5_000) {
    throw new PublishingError('INVALID_PUBLICATION', 'Le contenu doit contenir entre 1 et 5 000 caractères.');
  }
  return body;
}

function normalizeMediaReference(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > 1_000) {
    throw new PublishingError('INVALID_PUBLICATION', 'La référence média est invalide.');
  }
  return value.trim();
}

function normalizeDate(value: unknown) {
  const text = typeof value === 'string' ? value : '';
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) {
    throw new PublishingError('INVALID_PUBLICATION', 'Une date de publication valide est requise.');
  }
  if (date.getTime() < Date.now() - 60_000) {
    throw new PublishingError('INVALID_PUBLICATION', 'La date de publication ne peut pas être dans le passé.');
  }
  return date.toISOString();
}

function normalizeConnectionIds(value: unknown) {
  const ids = Array.isArray(value)
    ? [...new Set(value.filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0))]
    : [];
  if (!ids.length || ids.length > 20) {
    throw new PublishingError('INVALID_PUBLICATION', 'Choisissez entre 1 et 20 comptes connectés.');
  }
  return ids;
}

async function loadConnections(db: D1Database, workspaceId: string, ids: string[]) {
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT id, platform, display_name, status
     FROM social_connections
     WHERE workspace_id = ? AND id IN (${placeholders})`,
  ).bind(workspaceId, ...ids).all<ConnectionRow>();
  if (result.results.length !== ids.length) {
    throw new PublishingError('CONNECTION_NOT_FOUND', 'Un des comptes sélectionnés n’existe pas dans cet espace.');
  }
  const blocked = result.results.find((connection) => connection.status !== 'connected');
  if (blocked) throw new PublishingError('CONNECTION_NOT_READY', `${blocked.display_name} n’est pas prêt pour la publication.`);
  return result.results;
}

async function validateMediaReference(db: D1Database, workspaceId: string, mediaReference?: string) {
  if (!mediaReference) return;
  if (!mediaReference.startsWith('library:')) return;
  const mediaId = mediaReference.slice('library:'.length);
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) {
    throw new PublishingError('INVALID_PUBLICATION', 'La référence de bibliothèque est invalide.');
  }
  const exists = await db.prepare(
    `SELECT 1 AS present FROM media_library WHERE id = ? AND workspace_id = ?`,
  ).bind(mediaId, workspaceId).first<{ present: number }>();
  if (!exists) throw new PublishingError('INVALID_PUBLICATION', 'Le média sélectionné n’existe plus dans cette bibliothèque.');
}

export async function updatePublication(
  db: D1Database,
  principal: WorkspacePrincipal,
  publicationId: string,
  rawInput: {
    body?: unknown;
    mediaReference?: unknown;
    scheduledAt?: unknown;
    connectionIds?: unknown;
    expectedVersion?: unknown;
  },
) {
  const current = await db.prepare(
    `SELECT id, status, version
     FROM content_posts
     WHERE id = ? AND workspace_id = ?`,
  ).bind(publicationId, principal.workspaceId).first<{ id: string; status: string; version: number }>();

  if (!current) throw new PublishingError('PUBLICATION_NOT_FOUND', 'Publication introuvable.');
  if (current.status !== 'scheduled' && current.status !== 'draft') {
    throw new PublishingError('PUBLICATION_CONFLICT', 'Cette publication ne peut plus être modifiée.');
  }
  const expectedVersion = Number(rawInput.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
    throw new PublishingError('PUBLICATION_CONFLICT', 'Cette publication a été modifiée ailleurs. Rechargez le Planner.');
  }

  const body = normalizeBody(rawInput.body);
  const mediaReference = normalizeMediaReference(rawInput.mediaReference);
  const scheduledAt = normalizeDate(rawInput.scheduledAt);
  const connectionIds = normalizeConnectionIds(rawInput.connectionIds);
  const connections = await loadConnections(db, principal.workspaceId, connectionIds);
  await validateMediaReference(db, principal.workspaceId, mediaReference);

  const now = new Date().toISOString();
  const nextVersion = current.version + 1;
  const statements = [
    db.prepare(
      `UPDATE content_posts
       SET body = ?, media_reference = ?, scheduled_at = ?, version = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND version = ?`,
    ).bind(body, mediaReference ?? null, scheduledAt, nextVersion, now, publicationId, principal.workspaceId, current.version),
    db.prepare(`DELETE FROM content_post_targets WHERE post_id = ? AND workspace_id = ?`).bind(publicationId, principal.workspaceId),
    ...connections.map((connection) => db.prepare(
      `INSERT INTO content_post_targets
        (id, workspace_id, post_id, connection_id, platform, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      principal.workspaceId,
      publicationId,
      connection.id,
      connection.platform,
      now,
      now,
    )),
  ];
  await db.batch(statements);

  const listed = await listPublications(db, principal.workspaceId);
  const publication = listed.publications.find((candidate) => candidate.id === publicationId);
  if (!publication) throw new Error('Updated publication could not be reloaded.');
  return publication;
}
