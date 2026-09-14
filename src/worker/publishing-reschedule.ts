import type { WorkspacePrincipal } from './authorization';
import { listPublications, PublishingError } from './publishing';

export async function reschedulePublication(
  db: D1Database,
  principal: WorkspacePrincipal,
  publicationId: string,
  rawScheduledAt: unknown,
  expectedVersion: unknown,
) {
  if (typeof rawScheduledAt !== 'string') {
    throw new PublishingError('INVALID_PUBLICATION', 'Une nouvelle date de publication est requise.');
  }
  const scheduledAt = new Date(rawScheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60_000) {
    throw new PublishingError('INVALID_PUBLICATION', 'La nouvelle date de publication est invalide ou passée.');
  }

  const current = await db.prepare(
    `SELECT id, status, version
     FROM content_posts
     WHERE id = ? AND workspace_id = ?`,
  ).bind(publicationId, principal.workspaceId).first<{ id: string; status: string; version: number }>();

  if (!current) throw new PublishingError('PUBLICATION_NOT_FOUND', 'Publication introuvable.');
  if (current.status !== 'scheduled' && current.status !== 'draft') {
    throw new PublishingError('PUBLICATION_CONFLICT', 'Cette publication ne peut plus être reprogrammée.');
  }
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) !== current.version) {
    throw new PublishingError('PUBLICATION_CONFLICT', 'Cette publication a été modifiée ailleurs. Rechargez le planner.');
  }

  const now = new Date().toISOString();
  const updated = await db.prepare(
    `UPDATE content_posts
     SET scheduled_at = ?, status = 'scheduled', version = version + 1, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND version = ?
     RETURNING version`,
  ).bind(scheduledAt.toISOString(), now, publicationId, principal.workspaceId, current.version)
    .first<{ version: number }>();

  if (!updated) {
    throw new PublishingError('PUBLICATION_CONFLICT', 'Cette publication a changé pendant la reprogrammation. Rechargez le planner.');
  }

  await db.prepare(
    `UPDATE content_post_targets
     SET status = 'scheduled', updated_at = ?
     WHERE post_id = ? AND workspace_id = ? AND status != 'cancelled'`,
  ).bind(now, publicationId, principal.workspaceId).run();

  const listed = await listPublications(db, principal.workspaceId);
  const publication = listed.publications.find((candidate) => candidate.id === publicationId);
  if (!publication) throw new Error('Publication was rescheduled but could not be reloaded.');
  return publication;
}
