import { decryptToken, tokenKeyringSecret } from './token-vault';

type FacebookConnectionRow = {
  id: string;
  workspace_id: string;
  external_account_id: string;
  display_name: string;
  handle: string | null;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_key_version: string;
  scopes_json: string;
};

type FacebookPost = {
  id?: unknown;
  message?: unknown;
  created_time?: unknown;
  permalink_url?: unknown;
  attachments?: { data?: Array<{ type?: unknown; media_type?: unknown }> };
};

type FacebookComment = {
  id?: unknown;
  message?: unknown;
  created_time?: unknown;
  from?: { id?: unknown; name?: unknown };
};

type FacebookConversation = {
  id?: unknown;
  updated_time?: unknown;
  participants?: { data?: Array<{ id?: unknown; name?: unknown }> };
};

type FacebookMessage = {
  id?: unknown;
  message?: unknown;
  created_time?: unknown;
  from?: { id?: unknown; name?: unknown };
  to?: { data?: Array<{ id?: unknown; name?: unknown }> };
};

type GraphPage<T> = {
  data?: T[];
  paging?: { next?: unknown };
};

const SYNC_THROTTLE_MS = 2 * 60_000;
const MAX_POST_PAGES = 5;
const MAX_COMMENT_POSTS = 60;
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGE_PAGES = 2;

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function graphVersion(env: Env): string {
  const value = envString(env, 'META_GRAPH_VERSION');
  return value && /^v\d{1,3}\.\d{1,2}$/.test(value) ? value : 'v24.0';
}

function text(value: unknown, maximum = 5_000): string {
  if (typeof value === 'string') return value.trim().slice(0, maximum);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function iso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function safeHttps(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseScopes(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === 'string') : [];
  } catch {
    return [];
  }
}

async function graphGet<T>(fetchImpl: typeof fetch, url: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Facebook Graph request failed (${response.status})${body ? `: ${body.slice(0, 220)}` : ''}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadConnections(db: D1Database, workspaceId?: string): Promise<FacebookConnectionRow[]> {
  const sql = workspaceId
    ? `SELECT id, workspace_id, external_account_id, display_name, handle,
              access_token_ciphertext, access_token_iv, access_key_version, scopes_json
       FROM facebook_connections
       WHERE workspace_id = ? AND status = 'connected'
       ORDER BY display_name`
    : `SELECT id, workspace_id, external_account_id, display_name, handle,
              access_token_ciphertext, access_token_iv, access_key_version, scopes_json
       FROM facebook_connections
       WHERE status = 'connected'
       ORDER BY workspace_id, display_name`;
  const result = workspaceId
    ? await db.prepare(sql).bind(workspaceId).all<FacebookConnectionRow>()
    : await db.prepare(sql).all<FacebookConnectionRow>();
  return result.results;
}

async function pageToken(env: Env, connection: FacebookConnectionRow): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new Error('Facebook token encryption keyring is unavailable.');
  return decryptToken(keyring, {
    ciphertext: connection.access_token_ciphertext,
    iv: connection.access_token_iv,
    keyVersion: connection.access_key_version,
  }, {
    workspaceId: connection.workspace_id,
    connectionId: connection.id,
    provider: 'facebook',
    kind: 'access',
  });
}

async function syncAllowed(db: D1Database, connection: FacebookConnectionRow): Promise<boolean> {
  const state = await db.prepare(
    `SELECT last_attempt_at FROM facebook_runtime_sync_state
     WHERE workspace_id = ? AND connection_id = ?`,
  ).bind(connection.workspace_id, connection.id).first<{ last_attempt_at: string | null }>();
  if (!state?.last_attempt_at) return true;
  const last = Date.parse(state.last_attempt_at);
  return !Number.isFinite(last) || Date.now() - last >= SYNC_THROTTLE_MS;
}

async function markAttempt(db: D1Database, connection: FacebookConnectionRow) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO facebook_runtime_sync_state
       (workspace_id, connection_id, last_attempt_at, last_success_at, last_error)
     VALUES (?, ?, ?, NULL, NULL)
     ON CONFLICT(workspace_id, connection_id) DO UPDATE SET
       last_attempt_at = excluded.last_attempt_at,
       last_error = NULL`,
  ).bind(connection.workspace_id, connection.id, now).run();
}

async function markResult(db: D1Database, connection: FacebookConnectionRow, errors: string[]) {
  const now = new Date().toISOString();
  const error = errors.length ? errors.join(' | ').slice(0, 1_500) : null;
  await db.prepare(
    `UPDATE facebook_runtime_sync_state
     SET last_success_at = ?, last_error = ?
     WHERE workspace_id = ? AND connection_id = ?`,
  ).bind(errors.length ? null : now, error, connection.workspace_id, connection.id).run();
  if (!errors.length) {
    await db.prepare(
      `UPDATE facebook_connections SET last_synced_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(now, now, connection.id, connection.workspace_id).run();
  }
}

async function fetchPosts(env: Env, connection: FacebookConnectionRow, token: string, fetchImpl: typeof fetch): Promise<FacebookPost[]> {
  const initial = new URL(`https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(connection.external_account_id)}/posts`);
  initial.searchParams.set('fields', 'id,message,created_time,permalink_url,attachments{type,media_type}');
  initial.searchParams.set('limit', '100');
  let next: string | undefined = initial.toString();
  const posts: FacebookPost[] = [];
  for (let page = 0; next && page < MAX_POST_PAGES; page += 1) {
    const payload = await graphGet<GraphPage<FacebookPost>>(fetchImpl, next, token);
    if (Array.isArray(payload.data)) posts.push(...payload.data);
    next = typeof payload.paging?.next === 'string' && payload.paging.next.startsWith('https://')
      ? payload.paging.next
      : undefined;
  }
  return posts;
}

async function storePosts(db: D1Database, connection: FacebookConnectionRow, posts: FacebookPost[]): Promise<number> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const post of posts) {
    const externalId = text(post.id, 220);
    const eventAt = iso(post.created_time);
    if (!externalId || !eventAt) continue;
    const firstAttachment = Array.isArray(post.attachments?.data) ? post.attachments?.data?.[0] : undefined;
    const mediaType = text(firstAttachment?.media_type, 60) || text(firstAttachment?.type, 60) || undefined;
    statements.push(db.prepare(
      `INSERT INTO facebook_remote_posts
         (id, workspace_id, connection_id, external_id, body, media_type, external_url, event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, connection_id, external_id) DO UPDATE SET
         body = excluded.body,
         media_type = excluded.media_type,
         external_url = excluded.external_url,
         event_at = excluded.event_at,
         updated_at = excluded.updated_at`,
    ).bind(
      `fbpost:${connection.id}:${externalId}`,
      connection.workspace_id,
      connection.id,
      externalId,
      text(post.message) || 'Publication Facebook',
      mediaType ?? null,
      safeHttps(post.permalink_url) ?? null,
      eventAt,
      now,
      now,
    ));
  }
  for (let offset = 0; offset < statements.length; offset += 50) {
    await db.batch(statements.slice(offset, offset + 50));
  }
  return statements.length;
}

async function upsertConversationEvent(
  db: D1Database,
  input: {
    workspaceId: string;
    connectionId: string;
    externalContactId: string;
    contactName: string;
    externalMessageId: string;
    body: string;
    occurredAt: string;
    type: 'comment' | 'message';
    direction: 'inbound' | 'outbound';
  },
): Promise<boolean> {
  const contactId = `${input.workspaceId}:facebook:${input.externalContactId}`;
  const conversationId = `${input.connectionId}:${contactId}`;
  const eventId = `facebook:${input.connectionId}:${input.type}:${input.externalMessageId}`;
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, created_at, updated_at)
       VALUES (?, ?, ?, 'facebook', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
    ).bind(contactId, input.workspaceId, input.externalContactId, input.contactName, input.occurredAt, now),
    db.prepare(
      `INSERT INTO conversations
         (id, workspace_id, connection_id, contact_id, status, lead_stage, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', 'Nouveau', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_message_at = MAX(COALESCE(conversations.last_message_at, ''), excluded.last_message_at),
         updated_at = excluded.updated_at`,
    ).bind(conversationId, input.workspaceId, input.connectionId, contactId, input.occurredAt, input.occurredAt, now),
    db.prepare(
      `INSERT OR IGNORE INTO messages
         (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(eventId, conversationId, input.externalMessageId, input.direction, input.type, input.body, input.direction === 'outbound' ? 'sent' : 'received', input.occurredAt, now),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}

async function syncComments(
  db: D1Database,
  env: Env,
  connection: FacebookConnectionRow,
  token: string,
  posts: FacebookPost[],
  fetchImpl: typeof fetch,
): Promise<number> {
  let saved = 0;
  for (const post of posts.slice(0, MAX_COMMENT_POSTS)) {
    const postId = text(post.id, 220);
    if (!postId) continue;
    const url = new URL(`https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(postId)}/comments`);
    url.searchParams.set('fields', 'id,message,created_time,from{id,name}');
    url.searchParams.set('filter', 'stream');
    url.searchParams.set('limit', '100');
    const payload = await graphGet<GraphPage<FacebookComment>>(fetchImpl, url.toString(), token);
    for (const comment of Array.isArray(payload.data) ? payload.data : []) {
      const id = text(comment.id, 220);
      const body = text(comment.message);
      const fromId = text(comment.from?.id, 220);
      const occurredAt = iso(comment.created_time);
      if (!id || !body || !fromId || !occurredAt || fromId === connection.external_account_id) continue;
      if (await upsertConversationEvent(db, {
        workspaceId: connection.workspace_id,
        connectionId: connection.id,
        externalContactId: fromId,
        contactName: text(comment.from?.name, 180) || `Utilisateur Facebook ${fromId.slice(-4)}`,
        externalMessageId: id,
        body,
        occurredAt,
        type: 'comment',
        direction: 'inbound',
      })) saved += 1;
    }
  }
  return saved;
}

function externalParticipant(conversation: FacebookConversation, pageId: string) {
  const participants = Array.isArray(conversation.participants?.data) ? conversation.participants?.data ?? [] : [];
  return participants.find((participant) => text(participant.id, 220) && text(participant.id, 220) !== pageId);
}

async function syncMessages(
  db: D1Database,
  env: Env,
  connection: FacebookConnectionRow,
  token: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  const conversationsUrl = new URL(`https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(connection.external_account_id)}/conversations`);
  conversationsUrl.searchParams.set('fields', 'id,participants,updated_time');
  conversationsUrl.searchParams.set('limit', String(MAX_CONVERSATIONS));
  const conversationPayload = await graphGet<GraphPage<FacebookConversation>>(fetchImpl, conversationsUrl.toString(), token);
  let saved = 0;

  for (const conversation of Array.isArray(conversationPayload.data) ? conversationPayload.data : []) {
    const conversationId = text(conversation.id, 240);
    if (!conversationId) continue;
    const knownParticipant = externalParticipant(conversation, connection.external_account_id);
    let participantId = text(knownParticipant?.id, 220);
    let participantName = text(knownParticipant?.name, 180);

    const first = new URL(`https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(conversationId)}/messages`);
    first.searchParams.set('fields', 'id,message,created_time,from{id,name},to{id,name}');
    first.searchParams.set('limit', '100');
    let next: string | undefined = first.toString();
    const messages: FacebookMessage[] = [];
    for (let page = 0; next && page < MAX_MESSAGE_PAGES; page += 1) {
      const payload = await graphGet<GraphPage<FacebookMessage>>(fetchImpl, next, token);
      if (Array.isArray(payload.data)) messages.push(...payload.data);
      next = typeof payload.paging?.next === 'string' && payload.paging.next.startsWith('https://')
        ? payload.paging.next
        : undefined;
    }

    if (!participantId) {
      for (const message of messages) {
        const fromId = text(message.from?.id, 220);
        if (fromId && fromId !== connection.external_account_id) {
          participantId = fromId;
          participantName = text(message.from?.name, 180);
          break;
        }
        const recipients = Array.isArray(message.to?.data) ? message.to?.data ?? [] : [];
        const recipient = recipients.find((item) => text(item.id, 220) && text(item.id, 220) !== connection.external_account_id);
        if (recipient) {
          participantId = text(recipient.id, 220);
          participantName = text(recipient.name, 180);
          break;
        }
      }
    }
    if (!participantId) continue;

    for (const message of messages) {
      const id = text(message.id, 220);
      const body = text(message.message);
      const occurredAt = iso(message.created_time);
      const fromId = text(message.from?.id, 220);
      if (!id || !body || !occurredAt || !fromId) continue;
      const outbound = fromId === connection.external_account_id;
      if (await upsertConversationEvent(db, {
        workspaceId: connection.workspace_id,
        connectionId: connection.id,
        externalContactId: participantId,
        contactName: participantName || `Contact Facebook ${participantId.slice(-4)}`,
        externalMessageId: id,
        body,
        occurredAt,
        type: 'message',
        direction: outbound ? 'outbound' : 'inbound',
      })) saved += 1;
    }
  }
  return saved;
}

async function syncOneConnection(
  db: D1Database,
  env: Env,
  connection: FacebookConnectionRow,
  fetchImpl: typeof fetch,
  force = false,
) {
  if (!force && !await syncAllowed(db, connection)) {
    return { skipped: true, posts: 0, comments: 0, messages: 0, errors: [] as string[] };
  }
  await markAttempt(db, connection);
  const errors: string[] = [];
  let posts: FacebookPost[] = [];
  let postCount = 0;
  let comments = 0;
  let messages = 0;
  const scopes = parseScopes(connection.scopes_json);
  try {
    const token = await pageToken(env, connection);
    try {
      posts = await fetchPosts(env, connection, token, fetchImpl);
      postCount = await storePosts(db, connection, posts);
    } catch (error) {
      errors.push(`posts: ${error instanceof Error ? error.message : 'unknown'}`);
    }

    if (scopes.includes('pages_read_engagement') || scopes.includes('pages_manage_engagement') || scopes.includes('pages_read_user_content')) {
      try {
        comments = await syncComments(db, env, connection, token, posts, fetchImpl);
      } catch (error) {
        errors.push(`comments: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }

    if (scopes.includes('pages_messaging')) {
      try {
        messages = await syncMessages(db, env, connection, token, fetchImpl);
      } catch (error) {
        errors.push(`messenger: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  } catch (error) {
    errors.push(`token: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  await markResult(db, connection, errors);
  return { skipped: false, posts: postCount, comments, messages, errors };
}

export async function syncWorkspaceFacebookRuntime(
  db: D1Database,
  env: Env,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
  force = false,
) {
  const connections = await loadConnections(db, workspaceId);
  let synced = 0;
  let skipped = 0;
  let posts = 0;
  let comments = 0;
  let messages = 0;
  let failed = 0;
  for (const connection of connections) {
    const result = await syncOneConnection(db, env, connection, fetchImpl, force);
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    synced += 1;
    posts += result.posts;
    comments += result.comments;
    messages += result.messages;
    if (result.errors.length) failed += 1;
  }
  return { synced, skipped, failed, posts, comments, messages };
}

export async function syncAllFacebookRuntime(db: D1Database, env: Env, fetchImpl: typeof fetch = fetch) {
  const connections = await loadConnections(db);
  const workspaces = [...new Set(connections.map((connection) => connection.workspace_id))];
  const totals = { workspaces: 0, synced: 0, skipped: 0, failed: 0, posts: 0, comments: 0, messages: 0 };
  for (const workspaceId of workspaces) {
    const result = await syncWorkspaceFacebookRuntime(db, env, workspaceId, fetchImpl);
    totals.workspaces += 1;
    totals.synced += result.synced;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
    totals.posts += result.posts;
    totals.comments += result.comments;
    totals.messages += result.messages;
  }
  return totals;
}

export async function listFacebookPlannerPublications(db: D1Database, workspaceId: string) {
  const result = await db.prepare(
    `SELECT rp.id, rp.connection_id, rp.external_id, rp.body, rp.media_type, rp.external_url,
            rp.event_at, rp.created_at, rp.updated_at, fc.display_name, fc.handle
     FROM facebook_remote_posts rp
     JOIN facebook_connections fc ON fc.id = rp.connection_id AND fc.workspace_id = rp.workspace_id
     WHERE rp.workspace_id = ? AND fc.status = 'connected'
     ORDER BY rp.event_at ASC, rp.external_id ASC`,
  ).bind(workspaceId).all<{
    id: string;
    connection_id: string;
    external_id: string;
    body: string;
    media_type: string | null;
    external_url: string | null;
    event_at: string;
    created_at: string;
    updated_at: string;
    display_name: string;
    handle: string | null;
  }>();

  return result.results.map((row) => {
    const media = (row.media_type ?? '').toLowerCase();
    const format = media.includes('video') ? 'video' : 'post';
    return {
      id: `provider:${row.id}`,
      body: row.body,
      status: 'completed',
      scheduledAt: row.event_at,
      version: 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: 'provider' as const,
      readOnly: true,
      externalUrl: row.external_url ?? undefined,
      providerStatus: 'published' as const,
      targets: [{
        id: `provider-target:${row.id}`,
        connectionId: row.connection_id,
        platform: 'facebook' as const,
        status: 'published',
        displayName: row.display_name,
        handle: row.handle ?? undefined,
        format,
        fields: {},
        connected: true,
        connectionStatus: 'connected',
        syncStatus: 'uploaded',
        externalId: row.external_id,
        externalUrl: row.external_url ?? undefined,
        syncedAt: row.updated_at,
      }],
    };
  });
}
