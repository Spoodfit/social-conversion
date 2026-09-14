import type { WorkspacePrincipal } from './authorization';
import {
  connectedLegacyTargetStatements,
  DestinationValidationError,
  destinationInsertStatements,
  destinationPreviewText,
  resolvePublicationDestinations,
  type ResolvedPublicationDestination,
} from './publishing-destinations';
import type { PlanningPlatform } from '../shared/social-publication-fields';

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
  platform: PlanningPlatform | null;
  target_status: string | null;
  account_label: string | null;
  account_handle: string | null;
  format: string | null;
  fields_json: string | null;
  connected_display_name: string | null;
  connected_handle: string | null;
  connection_status: string | null;
};

export interface CreatePublicationInput {
  body?: unknown;
  mediaReference?: unknown;
  scheduledAt?: unknown;
  connectionIds?: unknown;
  destinations?: unknown;
}

export function normalizePublicationDate(value: unknown) {
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

export function normalizeMediaReference(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 1_000) {
    throw new PublishingError('INVALID_PUBLICATION', 'La référence média est invalide.');
  }
  return value.trim();
}

export async function validateMediaReference(db: D1Database, workspaceId: string, mediaReference?: string) {
  if (!mediaReference || !mediaReference.startsWith('library:')) return;
  const mediaId = mediaReference.slice('library:'.length);
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) {
    throw new PublishingError('INVALID_PUBLICATION', 'La référence de bibliothèque est invalide.');
  }
  const exists = await db.prepare(
    `SELECT 1 AS present FROM media_library WHERE id = ? AND workspace_id = ?`,
  ).bind(mediaId, workspaceId).first<{ present: number }>();
  if (!exists) throw new PublishingError('INVALID_PUBLICATION', 'Le média sélectionné n’existe plus dans cette bibliothèque.');
}

export function normalizePublicationBody(
  value: unknown,
  destinations: ResolvedPublicationDestination[],
  mediaReference?: string,
) {
  const explicit = typeof value === 'string' ? value.trim() : '';
  const derived = destinationPreviewText(destinations);
  const body = explicit || derived || (mediaReference ? `${destinations[0]?.accountLabel ?? 'Publication'} · média` : 'Publication planifiée');
  if (body.length > 5_000) {
    throw new PublishingError('INVALID_PUBLICATION', 'Le texte de prévisualisation dépasse 5 000 caractères.');
  }
  return body;
}

function mapDestinationError(error: unknown): never {
  if (error instanceof DestinationValidationError) {
    throw new PublishingError(
      error.kind === 'connection_not_found' ? 'CONNECTION_NOT_FOUND' : 'INVALID_PUBLICATION',
      error.message,
    );
  }
  throw error;
}

export async function resolveDestinationsOrPublishingError(
  db: D1Database,
  workspaceId: string,
  destinations: unknown,
  connectionIds?: unknown,
) {
  try {
    return await resolvePublicationDestinations(db, workspaceId, destinations, connectionIds);
  } catch (error) {
    return mapDestinationError(error);
  }
}

function parseFields(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
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
       d.id AS target_id,
       d.connection_id,
       d.platform,
       d.status AS target_status,
       d.account_label,
       d.account_handle,
       d.format,
       d.fields_json,
       sc.display_name AS connected_display_name,
       sc.handle AS connected_handle,
       sc.status AS connection_status
     FROM content_posts p
     LEFT JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id
     LEFT JOIN social_connections sc ON sc.id = d.connection_id AND sc.workspace_id = p.workspace_id
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
      connectionId?: string;
      platform: PlanningPlatform;
      status: string;
      displayName: string;
      handle?: string;
      format: string;
      fields: Record<string, unknown>;
      connected: boolean;
      connectionStatus?: string;
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
    if (row.target_id && row.platform && row.target_status) {
      existing.targets.push({
        id: row.target_id,
        connectionId: row.connection_id ?? undefined,
        platform: row.platform,
        status: row.target_status,
        displayName: row.connected_display_name ?? row.account_label ?? row.platform,
        handle: row.connected_handle ?? row.account_handle ?? undefined,
        format: row.format ?? 'post',
        fields: parseFields(row.fields_json),
        connected: Boolean(row.connection_id && row.connection_status === 'connected'),
        connectionStatus: row.connection_status ?? undefined,
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
  const destinations = await resolveDestinationsOrPublishingError(
    db,
    principal.workspaceId,
    rawInput.destinations,
    rawInput.connectionIds,
  );
  const mediaReference = normalizeMediaReference(rawInput.mediaReference);
  await validateMediaReference(db, principal.workspaceId, mediaReference);
  const body = normalizePublicationBody(rawInput.body, destinations, mediaReference);
  const scheduledAt = normalizePublicationDate(rawInput.scheduledAt);
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
      body,
      mediaReference ?? null,
      scheduledAt,
      principal.subject,
      now,
      now,
    ),
    ...destinationInsertStatements(db, principal.workspaceId, id, destinations, now),
    ...connectedLegacyTargetStatements(db, principal.workspaceId, id, destinations, now),
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
    db.prepare(
      `UPDATE content_post_destinations
       SET status = 'cancelled', updated_at = ?
       WHERE post_id = ? AND workspace_id = ? AND status IN ('planned', 'ready', 'blocked', 'failed')`,
    ).bind(now, publicationId, principal.workspaceId),
  ]);

  return { id: publicationId, status: 'cancelled', version: current.version + 1 };
}
