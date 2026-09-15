import type { NormalizedSocialEvent } from '../shared/types';

export async function persistSocialEvent(db: D1Database, event: NormalizedSocialEvent): Promise<'created' | 'duplicate'> {
  const receivedAt = new Date().toISOString();
  const contactId = `${event.workspaceId}:${event.platform}:${event.externalContactId}`;
  const conversationId = `${event.connectionId}:${contactId}`;
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO webhook_events
          (id, workspace_id, connection_id, external_event_id, platform, event_type, payload_json, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.workspaceId,
        event.connectionId,
        event.externalEventId,
        event.platform,
        event.eventType,
        JSON.stringify({ occurredAt: event.occurredAt }),
        receivedAt,
      ),
    db
      .prepare(
        `INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
      )
      .bind(
        contactId,
        event.workspaceId,
        event.externalContactId,
        event.platform,
        event.contactName,
        event.occurredAt,
        event.occurredAt,
      ),
    db
      .prepare(
        `INSERT INTO conversations
          (id, workspace_id, connection_id, contact_id, status, lead_stage, last_message_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', 'Nouveau', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_message_at = excluded.last_message_at, updated_at = excluded.updated_at`,
      )
      .bind(
        conversationId,
        event.workspaceId,
        event.connectionId,
        contactId,
        event.occurredAt,
        event.occurredAt,
        event.occurredAt,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO messages
          (id, conversation_id, external_id, direction, message_type, body, sent_at, created_at)
         VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        conversationId,
        event.id,
        event.eventType,
        event.text,
        event.occurredAt,
        event.occurredAt,
      ),
    db
      .prepare('UPDATE webhook_events SET processed_at = ? WHERE id = ?')
      .bind(receivedAt, event.id),
  ]);

  return (results[0]?.meta.changes ?? 0) === 0 ? 'duplicate' : 'created';
}
