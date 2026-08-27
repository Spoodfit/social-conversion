export class OutboxError extends Error {
  readonly code: 'INVALID_REQUEST' | 'CONVERSATION_NOT_FOUND' | 'IDEMPOTENCY_CONFLICT';

  constructor(code: OutboxError['code'], message: string) {
    super(message);
    this.name = 'OutboxError';
    this.code = code;
  }
}

export interface OutboxMessage {
  id: string;
  workspaceId: string;
  conversationId: string;
  connectionId: string;
  platform: 'instagram' | 'youtube' | 'tiktok';
  idempotencyKey: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  attemptCount: number;
  createdAt: string;
  replayed: boolean;
}

interface ConversationTarget {
  connection_id: string;
  platform: 'instagram' | 'youtube' | 'tiktok';
}

interface OutboxRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  connection_id: string;
  platform: 'instagram' | 'youtube' | 'tiktok';
  idempotency_key: string;
  request_hash: string;
  status: OutboxMessage['status'];
  attempt_count: number;
  created_at: string;
}

const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

async function requestHash(conversationId: string, body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${conversationId}\u0000${body}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toMessage(row: OutboxRow, replayed: boolean): OutboxMessage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    connectionId: row.connection_id,
    platform: row.platform,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    replayed,
  };
}

export async function enqueueOutbound(
  db: D1Database,
  input: {
    workspaceId: string;
    conversationId: string;
    idempotencyKey: string;
    body: string;
    actorId: string;
  },
): Promise<OutboxMessage> {
  const body = input.body.trim();
  if (!body || body.length > 2_000 || !idempotencyPattern.test(input.idempotencyKey)) {
    throw new OutboxError(
      'INVALID_REQUEST',
      'Outbound message requires a body up to 2,000 characters and an idempotency key of 8-128 safe characters.',
    );
  }

  const target = await db
    .prepare(
      `SELECT c.connection_id, sc.platform
       FROM conversations c
       JOIN social_connections sc ON sc.id = c.connection_id
       WHERE c.id = ?
         AND c.workspace_id = ?
         AND sc.workspace_id = ?
         AND sc.status = 'connected'`,
    )
    .bind(input.conversationId, input.workspaceId, input.workspaceId)
    .first<ConversationTarget>();

  if (!target) {
    throw new OutboxError('CONVERSATION_NOT_FOUND', 'Conversation or connected social target is unavailable in this workspace.');
  }

  const hash = await requestHash(input.conversationId, body);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const insert = await db
    .prepare(
      `INSERT OR IGNORE INTO outbound_messages
        (id, workspace_id, conversation_id, connection_id, platform,
         idempotency_key, request_hash, body, status, attempt_count,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    )
    .bind(
      id,
      input.workspaceId,
      input.conversationId,
      target.connection_id,
      target.platform,
      input.idempotencyKey,
      hash,
      body,
      input.actorId,
      now,
      now,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT id, workspace_id, conversation_id, connection_id, platform,
              idempotency_key, request_hash, status, attempt_count, created_at
       FROM outbound_messages
       WHERE workspace_id = ? AND idempotency_key = ?`,
    )
    .bind(input.workspaceId, input.idempotencyKey)
    .first<OutboxRow>();

  if (!row) throw new Error('Outbound outbox insert could not be read back.');
  if (row.request_hash !== hash || row.conversation_id !== input.conversationId) {
    throw new OutboxError(
      'IDEMPOTENCY_CONFLICT',
      'This idempotency key was already used for a different outbound request.',
    );
  }

  return toMessage(row, (insert.meta.changes ?? 0) === 0);
}

export async function claimOutboundForDelivery(
  db: D1Database,
  id: string,
  workspaceId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE outbound_messages
       SET status = 'sending', attempt_count = attempt_count + 1, updated_at = ?
       WHERE id = ? AND workspace_id = ?
         AND status IN ('pending', 'failed')
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
    )
    .bind(now, id, workspaceId, now)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function markOutboundSent(
  db: D1Database,
  input: { id: string; workspaceId: string; providerMessageId: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE outbound_messages
       SET status = 'sent', provider_message_id = ?, sent_at = ?,
           last_error_code = NULL, last_error_at = NULL, next_attempt_at = NULL,
           updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status = 'sending'`,
    )
    .bind(input.providerMessageId, now, now, input.id, input.workspaceId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function markOutboundFailed(
  db: D1Database,
  input: { id: string; workspaceId: string; errorCode: string; retryAt?: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE outbound_messages
       SET status = 'failed', last_error_code = ?, last_error_at = ?,
           next_attempt_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status = 'sending'`,
    )
    .bind(input.errorCode.slice(0, 128), now, input.retryAt ?? null, now, input.id, input.workspaceId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}
