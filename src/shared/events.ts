import type { NormalizedSocialEvent, SocialConnectionIdentity } from './types';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extractMetaExternalAccountIds(payload: unknown): string[] {
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const ids = new Set<string>();

  for (const item of entries.slice(0, 100)) {
    const id = asString(asRecord(item)?.id);
    if (id) ids.add(id);
  }

  return [...ids];
}

export function normalizeMetaWebhook(
  payload: unknown,
  connections: ReadonlyMap<string, SocialConnectionIdentity>,
): NormalizedSocialEvent[] {
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const events: NormalizedSocialEvent[] = [];

  for (const item of entries.slice(0, 100)) {
    const entry = asRecord(item);
    const externalAccountId = asString(entry?.id);
    const connection = externalAccountId ? connections.get(externalAccountId) : undefined;
    if (!connection) continue;

    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const rawMessage of messaging) {
      const messageEvent = asRecord(rawMessage);
      const sender = asRecord(messageEvent?.sender);
      const message = asRecord(messageEvent?.message);
      const senderId = asString(sender?.id);
      const text = asString(message?.text);
      const messageId = asString(message?.mid);
      if (!senderId || !text || !messageId) continue;

      events.push({
        id: `${connection.id}:${messageId}`,
        externalEventId: messageId,
        platform: 'instagram',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        eventType: 'message',
        externalContactId: senderId,
        contactName: `Contact ${senderId.slice(-4)}`,
        text,
        occurredAt: new Date(Number(messageEvent?.timestamp) || Date.now()).toISOString(),
      });
    }

    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const rawChange of changes) {
      const change = asRecord(rawChange);
      const value = asRecord(change?.value);
      const from = asRecord(value?.from);
      const externalContactId = asString(from?.id);
      const text = asString(value?.text);
      const id = asString(value?.id);
      if (!externalContactId || !text || !id) continue;

      events.push({
        id: `${connection.id}:${id}`,
        externalEventId: id,
        platform: 'instagram',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        eventType: 'comment',
        externalContactId,
        contactName: asString(from?.username) ?? `Contact ${externalContactId.slice(-4)}`,
        text,
        occurredAt: new Date().toISOString(),
      });
    }
  }

  return events;
}
