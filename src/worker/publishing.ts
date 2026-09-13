import type { WorkspacePrincipal } from './authorization';

export type PublishingErrorCode =
  | 'INVALID_PUBLICATION'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_NOT_READY'
  | 'PUBLICATION_NOT_FOUND'
  | 'PUBLICATION_CONFLICT';

export class PublishingError extends Error {
  constructor(public readonly code: PublishingErrorCode, message: string) {
    super(message);
    this.name = 'PublishingError';
  }
}

type PublishingPlatform = 'instagram' | 'youtube' | 'tiktok';

type ConnectionRow = {
  id: string;
  platform: PublishingPlatform;
  display_name: string;
  handle: string | null;
  status: string;
};

type PublishingJoinRow = {
  id: string;
  body: string;
  media_reference: string | null;
  status: 'draft' | 'scheduled' | 'cancelled' | 'completed';
  scheduled_at: string;
  version: number;
  created_at: string;
  updated_at: string;
  target_id: string | null;
  connection_id: string | null;
  platform: PublishingPlatform | null;
  target_status: string | null;
  display_name: string | null;
  handle: string | null;
};

export interface CreatePublicationInput {
  body?: unknown;
  mediaReference?: unknown;
  scheduledAt?: unknown;
  connectionIds?: unknown;
}

function normalizeCreateInput(input: CreatePublicationInput) {
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const mediaReference = typeof input.mediaReference === 'string' && input.mediaReference.trim()
    ? input.mediaReference.trim()
    : undefined;
  const scheduledAt = typeof input.scheduledAt === 'string' ? input.scheduledAt : '';
  const connectionIds = Array.isArray(input.connectionIds)
    ? [...new Set(input.connectionIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
    : [];

  if (!body || body.length > 5_000) {
    throw new PublishingError('INVALID_PUBLICATION', 'Le contenu doit contenir entre 1 et 5 000 caractères.');
  }
  if (mediaReference && mediaReference.length > 1_000) {
    throw new PublishingError('INVALID_PUBLICATION', 'La référence média est trop longue.');
  }
  if (connectionIds.length === 0 || connectionIds.length > 20) {
    throw new PublishingError('INVALID_PUBLICATION', 'Choisissez entre 1 et 20 comptes connectés.');
  }

  const date = new Date(scheduledAt);
  if (!scheduledAt || Number.isNaN(date.getTime())) {
    throw new PublishingError('INVALID_PUBLICATION', 'Une date de publication valide est requise.');
  }
  if (date.getTime() < Date.now() - 60_000) {
    throw new PublishingError('INVALID_PUBLICATION', 'La date de publication ne peut pas être dans le passé.');
  }

  return {
    body,
    mediaReference,
    scheduledAt: date.toISOString(),
    connectionIds,
  };
}

async function loadConnections(db: D1Database, workspaceId: string, ids: string[]): Promise<ConnectionRow[]> {
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT id, platform, display_name, handle, status
     FROM social_connections
     WHERE workspace_id = ? AND id IN (${placeholders})`,
  ).bind(workspaceId, ...ids).all<ConnectionRow>();

  if (result.results.length !== ids.length) {
    throw new PublishingError('CONNECTION_NOT_FOUND', 'Un des comptes sélectionnés n’existe pas dans cet espace.');
  }
  const blocked = result.results.find((connection) => connection.status !== 'connected');
  if (blocked) {
    throw new PublishingError('CONNECTION_NOT_READY', `${blocked.display_name} n’est pas prêt pour la publication.`);
  }
  return result.results;
}

export async function listPublications(db: D1Database, workspaceId: string) {
  const result = await db.prepare(
    `SELECT
       p.id,
       p.body,
       p.media_reference,
       p.status,
       p.scheduled_at,
       p.version,
       p.created_at,
       p.updated_at,
       t.id AS target_id,
       t.connection_id,
       t.platform,
       t.status AS target_status,
       sc.display_name,
       sc.handle
     FROM content_posts p
     LEFT JOIN content_post_targets t ON t.post_id = p.id
     LEFT JOIN social_connections sc ON sc.id = t.connection_id
     WHERE p.workspace_id = ? AND p.status != 'cancelled'
     ORDER BY p.scheduled_at ASC, p.created_at ASC`,
  ).bind(workspaceId).all<PublishingJoinRow>();

  const grouped = new Map<string, {
    id: string;
    body: string;
    mediaReference?: string;
    status: string;
    scheduledAt: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    targets: Array<{
      id: string;
      connectionId: string;
      platform: PublishingPlatform;
      status: string;
      displayName: string;
      handle?: string;
    }>;
  }>();

  for (const row of result.results) {
    const existing = grouped.get(row.id) ?? {
      id: row.id,
      body: row.body,
      mediaReference: row.media_reference ?? undefined,
      status: row.status,
      scheduledAt: row.scheduled_at,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      targets: [],
    };
    if (row.target_id && row.connection_id && row.platform && row.target_status) {
      existing.targets.push({
        id: row.target_id,
        connectionId: row.connection_id,
        platform: row.platform,
        status: row.target_status,
        displayName: row.display_name ?? row.platform,
        handle: row.handle ?? undefined,
      });
    }
    grouped.set(row.id, existing);
  }

  return { publications: [...grouped.values()] };
}

export async function createPublication(
  db: D1Database,
  principal: WorkspacePrincipal,
  rawInput: CreatePublicationInput,
) {
  const input = normalizeCreateInput(rawInput);
  const connections = await loadConnections(db, principal.workspaceId, input.connectionIds);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const statements = [
    db.prepare(
      `INSERT INTO content_posts (
         id, workspace_id, body, media_reference, status, scheduled_at, created_by, version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, 1, ?, ?)`,
    ).bind(
      id,
      principal.workspaceId,
      input.body,
      input.mediaReference ?? null,
      input.scheduledAt,
      principal.subject,
      now,
      now,
    ),
    ...connections.map((connection) => db.prepare(
      `INSERT INTO content_post_targets (
         id, workspace_id, post_id, connection_id, platform, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      principal.workspaceId,
      id,
      connection.id,
      connection.platform,
      now,
      now,
    )),
  ];

  await db.batch(statements);
  const listed = await listPublications(db, principal.workspaceId);
  const publication = listed.publications.find((candidate) => candidate.id === id);
  if (!publication) throw new Error('Publication was persisted but could not be reloaded.');
  return publication;
}

export async function cancelPublication(
  db: D1Database,
  principal: WorkspacePrincipal,
  publicationId: string,
  expectedVersion?: unknown,
) {
  const current = await db.prepare(
    `SELECT id, status, version
     FROM content_posts
     WHERE id = ? AND workspace_id = ?`,
  ).bind(publicationId, principal.workspaceId).first<{ id: string; status: string; version: number }>();

  if (!current) throw new PublishingError('PUBLICATION_NOT_FOUND', 'Publication introuvable.');
  if (current.status === 'cancelled') return { id: publicationId, status: 'cancelled', version: current.version };
  if (current.status === 'completed') {
    throw new PublishingError('PUBLICATION_CONFLICT', 'Une publication terminée ne peut plus être annulée.');
  }
  if (expectedVersion !== undefined && Number(expectedVersion) !== current.version) {
    throw new PublishingError('PUBLICATION_CONFLICT', 'Cette publication a été modifiée ailleurs. Rechargez le calendrier.');
  }

  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE content_posts
       SET status = 'cancelled', version = version + 1, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(now, publicationId, principal.workspaceId),
    db.prepare(
      `UPDATE content_post_targets
       SET status = 'cancelled', updated_at = ?
       WHERE post_id = ? AND workspace_id = ? AND status = 'scheduled'`,
    ).bind(now, publicationId, principal.workspaceId),
  ]);

  return { id: publicationId, status: 'cancelled', version: current.version + 1 };
}
