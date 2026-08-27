import { writeAuditLog, type WorkspacePrincipal } from './authorization';

export type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';
export type LeadStage = 'Nouveau' | 'Qualifié' | 'Rendez-vous' | 'Proposition' | 'Gagné' | 'Perdu';

const leadStages = new Set<LeadStage>(['Nouveau', 'Qualifié', 'Rendez-vous', 'Proposition', 'Gagné', 'Perdu']);
const platforms = new Set<SocialPlatform>(['instagram', 'youtube', 'tiktok']);
const statuses = new Set(['open', 'closed']);
const priorityPattern = /^[A-Za-zÀ-ÿ0-9 _-]{1,32}$/;

interface CursorPayload {
  at: string;
  id: string;
}

interface InboxConversationRow {
  id: string;
  contact_name: string;
  handle: string | null;
  platform: SocialPlatform;
  account_name: string;
  status: string;
  priority: string;
  intent: string | null;
  sentiment: string | null;
  lead_stage: string;
  estimated_value_cents: number;
  assigned_to: string | null;
  last_message_at: string | null;
  updated_at: string;
  latest_message_body: string | null;
  latest_message_direction: 'inbound' | 'outbound' | null;
  latest_message_type: string | null;
  latest_message_sent_at: string | null;
}

interface MessageRow {
  id: string;
  external_id: string | null;
  direction: 'inbound' | 'outbound';
  message_type: string;
  body: string;
  status: string;
  ai_assisted: number;
  sent_at: string;
  created_at: string;
}

interface ConversationMutationRow {
  id: string;
  lead_stage: string;
  estimated_value_cents: number;
  priority: string;
  assigned_to: string | null;
  updated_at: string;
}

export class LiveDataError extends Error {
  readonly code:
    | 'INVALID_QUERY'
    | 'INVALID_CURSOR'
    | 'INVALID_MUTATION'
    | 'CONVERSATION_NOT_FOUND'
    | 'CONVERSATION_CONFLICT';

  constructor(code: LiveDataError['code'], message: string) {
    super(message);
    this.name = 'LiveDataError';
    this.code = code;
  }
}

function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function decodeCursor(value: string | undefined): CursorPayload | undefined {
  if (!value) return undefined;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new LiveDataError('INVALID_CURSOR', 'Pagination cursor is invalid.');
  }

  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(base64)) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
    const candidate = parsed as Partial<CursorPayload>;
    if (
      typeof candidate.at !== 'string'
      || !Number.isFinite(Date.parse(candidate.at))
      || typeof candidate.id !== 'string'
      || !/^[A-Za-z0-9:_-]{1,200}$/.test(candidate.id)
    ) {
      throw new Error('invalid');
    }
    return { at: candidate.at, id: candidate.id };
  } catch {
    throw new LiveDataError('INVALID_CURSOR', 'Pagination cursor is invalid.');
  }
}

function normalizeLimit(value: string | undefined, fallback = 25, maximum = 50): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d{1,3}$/.test(value)) throw new LiveDataError('INVALID_QUERY', 'limit must be an integer.');
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) {
    throw new LiveDataError('INVALID_QUERY', `limit must be between 1 and ${maximum}.`);
  }
  return parsed;
}

function normalizeOptionalFilter<T extends string>(
  value: string | undefined,
  allowed: ReadonlySet<string>,
  field: string,
): T | undefined {
  if (!value) return undefined;
  if (!allowed.has(value)) throw new LiveDataError('INVALID_QUERY', `${field} is invalid.`);
  return value as T;
}

export async function listInboxConversations(
  db: D1Database,
  workspaceId: string,
  query: {
    limit?: string;
    cursor?: string;
    platform?: string;
    status?: string;
    stage?: string;
  } = {},
) {
  const limit = normalizeLimit(query.limit);
  const cursor = decodeCursor(query.cursor);
  const platform = normalizeOptionalFilter<SocialPlatform>(query.platform, platforms, 'platform');
  const status = normalizeOptionalFilter(query.status, statuses, 'status');
  const stage = normalizeOptionalFilter<LeadStage>(query.stage, leadStages, 'stage');

  const conditions = ['c.workspace_id = ?'];
  const bindings: unknown[] = [workspaceId];

  if (platform) {
    conditions.push('sc.platform = ?');
    bindings.push(platform);
  }
  if (status) {
    conditions.push('c.status = ?');
    bindings.push(status);
  }
  if (stage) {
    conditions.push('c.lead_stage = ?');
    bindings.push(stage);
  }
  if (cursor) {
    conditions.push(`(
      COALESCE(c.last_message_at, c.updated_at) < ?
      OR (COALESCE(c.last_message_at, c.updated_at) = ? AND c.id < ?)
    )`);
    bindings.push(cursor.at, cursor.at, cursor.id);
  }

  bindings.push(limit + 1);
  const result = await db.prepare(
    `SELECT
       c.id,
       ct.display_name AS contact_name,
       ct.handle,
       sc.platform,
       sc.display_name AS account_name,
       c.status,
       c.priority,
       c.intent,
       c.sentiment,
       c.lead_stage,
       c.estimated_value_cents,
       c.assigned_to,
       c.last_message_at,
       c.updated_at,
       (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_body,
       (SELECT m.direction FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_direction,
       (SELECT m.message_type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_type,
       (SELECT m.sent_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_sent_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id
     JOIN social_connections sc ON sc.id = c.connection_id AND sc.workspace_id = c.workspace_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC, c.id DESC
     LIMIT ?`,
  ).bind(...bindings).all<InboxConversationRow>();

  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  const nextCursor = hasMore && last
    ? encodeCursor({ at: last.last_message_at ?? last.updated_at, id: last.id })
    : undefined;

  return {
    conversations: rows.map((row) => ({
      id: row.id,
      contactName: row.contact_name,
      handle: row.handle ?? undefined,
      platform: row.platform,
      accountName: row.account_name,
      status: row.status,
      priority: row.priority,
      intent: row.intent ?? undefined,
      sentiment: row.sentiment ?? undefined,
      leadStage: row.lead_stage,
      estimatedValueCents: row.estimated_value_cents,
      assignedTo: row.assigned_to ?? undefined,
      lastMessageAt: row.last_message_at ?? undefined,
      updatedAt: row.updated_at,
      latestMessage: row.latest_message_sent_at ? {
        body: row.latest_message_body ?? '',
        direction: row.latest_message_direction,
        type: row.latest_message_type ?? 'message',
        sentAt: row.latest_message_sent_at,
      } : undefined,
    })),
    page: { limit, hasMore, nextCursor },
  };
}

export async function listConversationMessages(
  db: D1Database,
  workspaceId: string,
  conversationId: string,
  query: { limit?: string; cursor?: string } = {},
) {
  const limit = normalizeLimit(query.limit, 50, 100);
  const cursor = decodeCursor(query.cursor);
  const conditions = ['c.workspace_id = ?', 'c.id = ?'];
  const bindings: unknown[] = [workspaceId, conversationId];
  if (cursor) {
    conditions.push('(m.sent_at < ? OR (m.sent_at = ? AND m.id < ?))');
    bindings.push(cursor.at, cursor.at, cursor.id);
  }
  bindings.push(limit + 1);

  const result = await db.prepare(
    `SELECT m.id, m.external_id, m.direction, m.message_type, m.body,
            m.status, m.ai_assisted, m.sent_at, m.created_at
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY m.sent_at DESC, m.id DESC
     LIMIT ?`,
  ).bind(...bindings).all<MessageRow>();

  if (result.results.length === 0) {
    const exists = await db.prepare(
      'SELECT 1 AS present FROM conversations WHERE id = ? AND workspace_id = ?',
    ).bind(conversationId, workspaceId).first<{ present: number }>();
    if (!exists) throw new LiveDataError('CONVERSATION_NOT_FOUND', 'Conversation not found in this workspace.');
  }

  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ at: last.sent_at, id: last.id }) : undefined;

  return {
    conversationId,
    messages: rows.map((row) => ({
      id: row.id,
      externalId: row.external_id ?? undefined,
      direction: row.direction,
      type: row.message_type,
      body: row.body,
      status: row.status,
      aiAssisted: row.ai_assisted === 1,
      sentAt: row.sent_at,
      createdAt: row.created_at,
    })),
    page: { limit, hasMore, nextCursor },
  };
}

export async function updateConversationCrm(
  db: D1Database,
  principal: WorkspacePrincipal,
  conversationId: string,
  input: {
    expectedUpdatedAt?: string;
    leadStage?: string;
    estimatedValueCents?: number;
    priority?: string;
    assignedTo?: string | null;
  },
): Promise<ConversationMutationRow> {
  if (!input.expectedUpdatedAt || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
    throw new LiveDataError('INVALID_MUTATION', 'expectedUpdatedAt is required for safe concurrent updates.');
  }
  if (input.leadStage !== undefined && !leadStages.has(input.leadStage as LeadStage)) {
    throw new LiveDataError('INVALID_MUTATION', 'leadStage is invalid.');
  }
  if (
    input.estimatedValueCents !== undefined
    && (!Number.isInteger(input.estimatedValueCents) || input.estimatedValueCents < 0 || input.estimatedValueCents > 1_000_000_000)
  ) {
    throw new LiveDataError('INVALID_MUTATION', 'estimatedValueCents must be an integer between 0 and 1,000,000,000.');
  }
  if (input.priority !== undefined && !priorityPattern.test(input.priority.trim())) {
    throw new LiveDataError('INVALID_MUTATION', 'priority is invalid.');
  }
  if (input.assignedTo !== undefined && input.assignedTo !== null) {
    const assignee = input.assignedTo.trim();
    if (!assignee || assignee.length > 200) throw new LiveDataError('INVALID_MUTATION', 'assignedTo is invalid.');
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  const changedFields: string[] = [];
  if (input.leadStage !== undefined) {
    fields.push('lead_stage = ?');
    values.push(input.leadStage);
    changedFields.push('leadStage');
  }
  if (input.estimatedValueCents !== undefined) {
    fields.push('estimated_value_cents = ?');
    values.push(input.estimatedValueCents);
    changedFields.push('estimatedValueCents');
  }
  if (input.priority !== undefined) {
    fields.push('priority = ?');
    values.push(input.priority.trim());
    changedFields.push('priority');
  }
  if (input.assignedTo !== undefined) {
    fields.push('assigned_to = ?');
    values.push(input.assignedTo === null ? null : input.assignedTo.trim());
    changedFields.push('assignedTo');
  }
  if (fields.length === 0) throw new LiveDataError('INVALID_MUTATION', 'At least one CRM field must be changed.');

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now, conversationId, principal.workspaceId, input.expectedUpdatedAt);

  const updated = await db.prepare(
    `UPDATE conversations
     SET ${fields.join(', ')}
     WHERE id = ? AND workspace_id = ? AND updated_at = ?
     RETURNING id, lead_stage, estimated_value_cents, priority, assigned_to, updated_at`,
  ).bind(...values).first<ConversationMutationRow>();

  if (!updated) {
    const current = await db.prepare(
      'SELECT updated_at FROM conversations WHERE id = ? AND workspace_id = ?',
    ).bind(conversationId, principal.workspaceId).first<{ updated_at: string }>();
    if (!current) throw new LiveDataError('CONVERSATION_NOT_FOUND', 'Conversation not found in this workspace.');
    throw new LiveDataError('CONVERSATION_CONFLICT', 'Conversation changed since it was loaded. Refresh before retrying.');
  }

  await writeAuditLog(db, principal, 'crm.conversation_updated', 'conversation', conversationId, {
    changedFieldCount: changedFields.length,
    changedFields: changedFields.join(','),
  });

  return updated;
}
