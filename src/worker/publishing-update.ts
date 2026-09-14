import type { WorkspacePrincipal } from './authorization';
import {
  listPublications,
  normalizeMediaReference,
  normalizePublicationBody,
  normalizePublicationDate,
  PublishingError,
  resolveDestinationsOrPublishingError,
  validateMediaReference,
} from './publishing';
import {
  connectedLegacyTargetStatements,
  destinationInsertStatements,
} from './publishing-destinations';

export async function updatePublication(
  db: D1Database,
  principal: WorkspacePrincipal,
  publicationId: string,
  rawInput: {
    body?: unknown;
    mediaReference?: unknown;
    scheduledAt?: unknown;
    connectionIds?: unknown;
    destinations?: unknown;
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

  const now = new Date().toISOString();
  const nextVersion = current.version + 1;
  const statements = [
    db.prepare(
      `UPDATE content_posts
       SET body = ?, media_reference = ?, scheduled_at = ?, version = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND version = ?`,
    ).bind(body, mediaReference ?? null, scheduledAt, nextVersion, now, publicationId, principal.workspaceId, current.version),
    db.prepare(`DELETE FROM content_post_targets WHERE post_id = ? AND workspace_id = ?`).bind(publicationId, principal.workspaceId),
    db.prepare(`DELETE FROM content_post_destinations WHERE post_id = ? AND workspace_id = ?`).bind(publicationId, principal.workspaceId),
    ...destinationInsertStatements(db, principal.workspaceId, publicationId, destinations, now),
    ...connectedLegacyTargetStatements(db, principal.workspaceId, publicationId, destinations, now),
  ];
  await db.batch(statements);

  const listed = await listPublications(db, principal.workspaceId);
  const publication = listed.publications.find((candidate) => candidate.id === publicationId);
  if (!publication) throw new Error('Updated publication could not be reloaded.');
  return publication;
}
