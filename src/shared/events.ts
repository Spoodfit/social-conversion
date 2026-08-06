import type { NormalizedSocialEvent } from './types';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeMetaWebhook(payload: unknown, connectionId = 'meta-default'): NormalizedSocialEvent[] {
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const events: NormalizedSocialEvent[] = [];

  for (const item of entries) {
    const entry = asRecord(item);
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
        id: messageId,
        platform: 'instagram',
        connectionId,
        eventType: 'message',
        externalContactId: senderId,
        contactName: `Contact ${senderId.slice(-4)}`,
        text,
        occurredAt: new Date(Number(messageEvent?.timestamp) || Date.now()).toISOString(),
        raw: rawMessage,
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
        id,
        platform: 'instagram',
        connectionId,
        eventType: 'comment',
        externalContactId,
        contactName: asString(from?.username) ?? `Contact ${externalContactId.slice(-4)}`,
        text,
        occurredAt: new Date().toISOString(),
        raw: rawChange,
      });
    }
  }

  return events;
}
