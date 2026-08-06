import type { NormalizedSocialEvent } from '../shared/types';

export async function persistSocialEvent(db: D1Database, event: NormalizedSocialEvent): Promise<'created' | 'duplicate'> {
  const gate = await db
    .prepare(
      `INSERT OR IGNORE INTO webhook_events
        (id, platform, event_type, payload_json, received_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(event.id, event.platform, event.eventType, JSON.stringify(event.raw), new Date().toISOString())
    .run();

  if ((gate.meta.changes ?? 0) === 0) return 'duplicate';

  const contactId = `${event.platform}:${event.externalContactId}`;
  const conversationId = `${event.connectionId}:${contactId}`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, created_at, updated_at)
         VALUES (?, 'default', ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
      )
      .bind(contactId, event.externalContactId, event.platform, event.contactName, event.occurredAt, event.occurredAt),
    db
      .prepare(
        `INSERT INTO conversations
          (id, workspace_id, connection_id, contact_id, status, lead_stage, last_message_at, created_at, updated_at)
         VALUES (?, 'default', ?, ?, 'open', 'Nouveau', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_message_at = excluded.last_message_at, updated_at = excluded.updated_at`,
      )
      .bind(conversationId, event.connectionId, contactId, event.occurredAt, event.occurredAt, event.occurredAt),
    db
      .prepare(
        `INSERT OR IGNORE INTO messages
          (id, conversation_id, external_id, direction, message_type, body, sent_at, created_at)
         VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?)`,
      )
      .bind(event.id, conversationId, event.id, event.eventType, event.text, event.occurredAt, event.occurredAt),
  ]);

  return 'created';
}
