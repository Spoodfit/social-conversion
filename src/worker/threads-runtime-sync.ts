import { decryptToken, tokenKeyringSecret } from './token-vault';

type ThreadsConnectionRow = {
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

type ThreadsPost = {
  id?: unknown;
  text?: unknown;
  timestamp?: unknown;
  media_type?: unknown;
  media_url?: unknown;
  thumbnail_url?: unknown;
  permalink?: unknown;
  username?: unknown;
  has_replies?: unknown;
};

type ThreadsReply = ThreadsPost & {
  is_reply_owned_by_me?: unknown;
  root_post?: { id?: unknown };
  replied_to?: { id?: unknown };
};

type ThreadsPage<T> = {
  data?: T[];
  paging?: {
    next?: unknown;
    cursors?: { after?: unknown };
  };
};

const SYNC_THROTTLE_MS = 2 * 60_000;
const MAX_POST_PAGES = 4;
const MAX_REPLY_POSTS = 30;
const REPLY_BATCH_SIZE = 5;
const API_HOST = 'https://graph.threads.net';

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

async function threadsGet<T>(fetchImpl: typeof fetch, url: string, token: string): Promise<ThreadsPage<T>> {
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
      throw new Error(`Threads API request failed (${response.status})${body ? `: ${body.slice(0, 300)}` : ''}`);
    }
    return await response.json() as ThreadsPage<T>;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPages<T>(
  fetchImpl: typeof fetch,
  initialUrl: URL,
  token: string,
  maximumPages: number,
): Promise<T[]> {
  const items: T[] = [];
  let next: URL | undefined = new URL(initialUrl.toString());
  for (let page = 0; next && page < maximumPages; page += 1) {
    const current = next;
    const payload = await threadsGet<T>(fetchImpl, current.toString(), token);
    if (Array.isArray(payload.data)) items.push(...payload.data);
    const providerNext = safeHttps(payload.paging?.next);
    if (providerNext) {
      next = new URL(providerNext);
      continue;
    }
    const after = text(payload.paging?.cursors?.after, 1_000);
    if (!after) {
      next = undefined;
      continue;
    }
    next = new URL(initialUrl.toString());
    next.searchParams.set('after', after);
  }
  return items;
}

async function loadConnections(db: D1Database, workspaceId?: string): Promise<ThreadsConnectionRow[]> {
  const sql = workspaceId
    ? `SELECT id, workspace_id, external_account_id, display_name, handle,
              access_token_ciphertext, access_token_iv, access_key_version, scopes_json
       FROM threads_connections
       WHERE workspace_id = ? AND status = 'connected'
       ORDER BY display_name`
    : `SELECT id, workspace_id, external_account_id, display_name, handle,
              access_token_ciphertext, access_token_iv, access_key_version, scopes_json
       FROM threads_connections
       WHERE status = 'connected'
       ORDER BY workspace_id, display_name`;
  const result = workspaceId
    ? await db.prepare(sql).bind(workspaceId).all<ThreadsConnectionRow>()
    : await db.prepare(sql).all<ThreadsConnectionRow>();
  return result.results;
}

async function accessToken(env: Env, connection: ThreadsConnectionRow): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new Error('Threads token encryption keyring is unavailable.');
  return decryptToken(keyring, {
    ciphertext: connection.access_token_ciphertext,
    iv: connection.access_token_iv,
    keyVersion: connection.access_key_version,
  }, {
    workspaceId: connection.workspace_id,
    connectionId: connection.id,
    provider: 'threads',
    kind: 'access',
  });
}

async function syncAllowed(db: D1Database, connection: ThreadsConnectionRow): Promise<boolean> {
  const state = await db.prepare(
    `SELECT last_attempt_at FROM threads_runtime_sync_state
     WHERE workspace_id = ? AND connection_id = ?`,
  ).bind(connection.workspace_id, connection.id).first<{ last_attempt_at: string | null }>();
  if (!state?.last_attempt_at) return true;
  const last = Date.parse(state.last_attempt_at);
  return !Number.isFinite(last) || Date.now() - last >= SYNC_THROTTLE_MS;
}

async function markAttempt(db: D1Database, connection: ThreadsConnectionRow) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO threads_runtime_sync_state
       (workspace_id, connection_id, last_attempt_at, last_success_at, last_error)
     VALUES (?, ?, ?, NULL, NULL)
     ON CONFLICT(workspace_id, connection_id) DO UPDATE SET
       last_attempt_at = excluded.last_attempt_at,
       last_error = NULL`,
  ).bind(connection.workspace_id, connection.id, now).run();
}

async function markResult(db: D1Database, connection: ThreadsConnectionRow, errors: string[]) {
  const now = new Date().toISOString();
  const error = errors.length ? errors.join(' | ').slice(0, 1_500) : null;
  await db.prepare(
    `UPDATE threads_runtime_sync_state
     SET last_success_at = ?, last_error = ?
     WHERE workspace_id = ? AND connection_id = ?`,
  ).bind(errors.length ? null : now, error, connection.workspace_id, connection.id).run();
  if (!errors.length) {
    await db.prepare(
      `UPDATE threads_connections SET last_synced_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(now, now, connection.id, connection.workspace_id).run();
  }
}

async function fetchOwnPosts(connection: ThreadsConnectionRow, token: string, fetchImpl: typeof fetch) {
  const url = new URL(`${API_HOST}/me/threads`);
  url.searchParams.set('fields', 'id,text,timestamp,media_type,media_url,thumbnail_url,permalink,username,has_replies');
  url.searchParams.set('limit', '50');
  const posts = await fetchPages<ThreadsPost>(fetchImpl, url, token, MAX_POST_PAGES);
  return posts.filter((post) => text(post.id, 250) && iso(post.timestamp));
}

async function storePosts(db: D1Database, connection: ThreadsConnectionRow, posts: ThreadsPost[]): Promise<number> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const post of posts) {
    const externalId = text(post.id, 250);
    const eventAt = iso(post.timestamp);
    if (!externalId || !eventAt) continue;
    statements.push(db.prepare(
      `INSERT INTO threads_remote_posts
         (id, workspace_id, connection_id, external_id, body, media_type, preview_url, external_url, event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, connection_id, external_id) DO UPDATE SET
         body = excluded.body,
         media_type = excluded.media_type,
         preview_url = excluded.preview_url,
         external_url = excluded.external_url,
         event_at = excluded.event_at,
         updated_at = excluded.updated_at`,
    ).bind(
      `thpost:${connection.id}:${externalId}`,
      connection.workspace_id,
      connection.id,
      externalId,
      text(post.text) || 'Publication Threads',
      text(post.media_type, 80) || null,
      safeHttps(post.thumbnail_url) ?? safeHttps(post.media_url) ?? null,
      safeHttps(post.permalink) ?? null,
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

function ownUsername(connection: ThreadsConnectionRow): string {
  return (connection.handle ?? '').trim().replace(/^@+/, '').toLowerCase();
}

async function upsertInteraction(
  db: D1Database,
  connection: ThreadsConnectionRow,
  input: {
    itemId: string;
    username: string;
    body: string;
    occurredAt: string;
    permalink?: string;
    kind: 'reply' | 'mention';
    rootPostId?: string;
    repliedToId?: string;
  },
): Promise<boolean> {
  const normalizedUsername = input.username.trim().replace(/^@+/, '').toLowerCase();
  const externalContactId = normalizedUsername ? `username:${normalizedUsername}` : `interaction:${input.itemId}`;
  const contactId = `${connection.workspace_id}:threads:${externalContactId}`;
  const conversationId = `${connection.id}:${contactId}`;
  const messageId = `threads:${connection.id}:${input.itemId}`;
  const externalMessageId = `threads:${connection.id}:${input.itemId}`;
  const now = new Date().toISOString();
  const displayName = normalizedUsername ? `@${normalizedUsername}` : 'Utilisateur Threads';
  const context = JSON.stringify({
    platform: 'threads',
    interactionType: input.kind,
    externalPostId: input.rootPostId ?? input.itemId,
    repliedToId: input.repliedToId,
    externalUrl: input.permalink,
  });
  const results = await db.batch([
    db.prepare(
      `INSERT INTO contacts
         (id, workspace_id, external_id, platform, display_name, handle, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, 'threads', ?, ?, '{}', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         handle = excluded.handle,
         updated_at = excluded.updated_at`,
    ).bind(contactId, connection.workspace_id, externalContactId, displayName, normalizedUsername ? `@${normalizedUsername}` : null, input.occurredAt, now),
    db.prepare(
      `INSERT INTO conversations
         (id, workspace_id, connection_id, contact_id, status, lead_stage, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', 'Nouveau', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_message_at = MAX(COALESCE(conversations.last_message_at, ''), excluded.last_message_at),
         updated_at = excluded.updated_at`,
    ).bind(conversationId, connection.workspace_id, connection.id, contactId, input.occurredAt, input.occurredAt, now),
    db.prepare(
      `INSERT OR IGNORE INTO messages
         (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at, context_json)
       VALUES (?, ?, ?, 'inbound', 'comment', ?, 'received', ?, ?, ?)`,
    ).bind(messageId, conversationId, externalMessageId, input.body, input.occurredAt, now, context),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}

async function fetchThreadConversation(
  threadId: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<ThreadsReply[]> {
  const url = new URL(`${API_HOST}/${encodeURIComponent(threadId)}/conversation`);
  url.searchParams.set('fields', 'id,text,timestamp,media_type,permalink,username,is_reply_owned_by_me,root_post,replied_to');
  url.searchParams.set('reverse', 'false');
  url.searchParams.set('limit', '100');
  return fetchPages<ThreadsReply>(fetchImpl, url, token, 1);
}

async function syncReplies(
  db: D1Database,
  connection: ThreadsConnectionRow,
  posts: ThreadsPost[],
  token: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  const self = ownUsername(connection);
  const candidates = posts
    .filter((post) => post.has_replies === true || String(post.has_replies).toLowerCase() === 'true')
    .slice(0, MAX_REPLY_POSTS);
  let saved = 0;
  for (let offset = 0; offset < candidates.length; offset += REPLY_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + REPLY_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(async (post) => {
      const rootId = text(post.id, 250);
      if (!rootId) return 0;
      const replies = await fetchThreadConversation(rootId, token, fetchImpl);
      let count = 0;
      for (const reply of replies) {
        const itemId = text(reply.id, 250);
        const body = text(reply.text);
        const occurredAt = iso(reply.timestamp);
        const username = text(reply.username, 200).replace(/^@+/, '');
        if (!itemId || !body || !occurredAt) continue;
        if (reply.is_reply_owned_by_me === true || (self && username.toLowerCase() === self)) continue;
        if (await upsertInteraction(db, connection, {
          itemId,
          username,
          body,
          occurredAt,
          permalink: safeHttps(reply.permalink),
          kind: 'reply',
          rootPostId: text(reply.root_post?.id, 250) || rootId,
          repliedToId: text(reply.replied_to?.id, 250) || undefined,
        })) count += 1;
      }
      return count;
    }));
    for (const result of results) {
      if (result.status === 'fulfilled') saved += result.value;
      else throw result.reason;
    }
  }
  return saved;
}

async function syncMentions(
  db: D1Database,
  connection: ThreadsConnectionRow,
  token: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  const self = ownUsername(connection);
  const url = new URL(`${API_HOST}/me/mentions`);
  url.searchParams.set('fields', 'id,text,timestamp,media_type,permalink,username,has_replies');
  url.searchParams.set('limit', '50');
  const mentions = await fetchPages<ThreadsPost>(fetchImpl, url, token, 2);
  let saved = 0;
  for (const mention of mentions) {
    const itemId = text(mention.id, 250);
    const body = text(mention.text);
    const occurredAt = iso(mention.timestamp);
    const username = text(mention.username, 200).replace(/^@+/, '');
    if (!itemId || !body || !occurredAt) continue;
    if (self && username.toLowerCase() === self) continue;
    if (await upsertInteraction(db, connection, {
      itemId,
      username,
      body,
      occurredAt,
      permalink: safeHttps(mention.permalink),
      kind: 'mention',
      rootPostId: itemId,
    })) saved += 1;
  }
  return saved;
}

async function syncOneConnection(
  db: D1Database,
  env: Env,
  connection: ThreadsConnectionRow,
  fetchImpl: typeof fetch,
  force = false,
) {
  if (!force && !await syncAllowed(db, connection)) {
    return { skipped: true, posts: 0, replies: 0, mentions: 0, errors: [] as string[] };
  }
  await markAttempt(db, connection);
  const errors: string[] = [];
  const scopes = parseScopes(connection.scopes_json);
  let posts: ThreadsPost[] = [];
  let postCount = 0;
  let replies = 0;
  let mentions = 0;
  try {
    const token = await accessToken(env, connection);
    try {
      posts = await fetchOwnPosts(connection, token, fetchImpl);
      postCount = await storePosts(db, connection, posts);
    } catch (error) {
      errors.push(`posts: ${error instanceof Error ? error.message : 'unknown'}`);
    }

    if (scopes.includes('threads_read_replies') || scopes.includes('threads_manage_replies')) {
      try {
        replies = await syncReplies(db, connection, posts, token, fetchImpl);
      } catch (error) {
        errors.push(`replies: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }

    if (scopes.includes('threads_manage_mentions')) {
      try {
        mentions = await syncMentions(db, connection, token, fetchImpl);
      } catch (error) {
        errors.push(`mentions: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  } catch (error) {
    errors.push(`token: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  await markResult(db, connection, errors);
  return { skipped: false, posts: postCount, replies, mentions, errors };
}

export async function syncWorkspaceThreadsRuntime(
  db: D1Database,
  env: Env,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
  force = false,
) {
  const connections = await loadConnections(db, workspaceId);
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let posts = 0;
  let replies = 0;
  let mentions = 0;
  for (const connection of connections) {
    const result = await syncOneConnection(db, env, connection, fetchImpl, force);
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    synced += 1;
    posts += result.posts;
    replies += result.replies;
    mentions += result.mentions;
    if (result.errors.length) failed += 1;
  }
  return { synced, skipped, failed, posts, replies, mentions, directMessages: 0 };
}

export async function syncAllThreadsRuntime(db: D1Database, env: Env, fetchImpl: typeof fetch = fetch) {
  const connections = await loadConnections(db);
  const workspaces = [...new Set(connections.map((connection) => connection.workspace_id))];
  const totals = { workspaces: 0, synced: 0, skipped: 0, failed: 0, posts: 0, replies: 0, mentions: 0, directMessages: 0 };
  for (const workspaceId of workspaces) {
    const result = await syncWorkspaceThreadsRuntime(db, env, workspaceId, fetchImpl);
    totals.workspaces += 1;
    totals.synced += result.synced;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
    totals.posts += result.posts;
    totals.replies += result.replies;
    totals.mentions += result.mentions;
  }
  return totals;
}

export async function listThreadsPlannerPublications(db: D1Database, workspaceId: string) {
  const result = await db.prepare(
    `SELECT rp.id, rp.connection_id, rp.external_id, rp.body, rp.media_type, rp.preview_url, rp.external_url,
            rp.event_at, rp.created_at, rp.updated_at, tc.display_name, tc.handle
     FROM threads_remote_posts rp
     JOIN threads_connections tc ON tc.id = rp.connection_id AND tc.workspace_id = rp.workspace_id
     WHERE rp.workspace_id = ? AND tc.status = 'connected'
     ORDER BY rp.event_at ASC, rp.external_id ASC`,
  ).bind(workspaceId).all<{
    id: string;
    connection_id: string;
    external_id: string;
    body: string;
    media_type: string | null;
    preview_url: string | null;
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
      previewUrl: row.preview_url ?? undefined,
      providerMediaType: row.media_type ?? undefined,
      providerEditable: false,
      providerStatus: 'published' as const,
      targets: [{
        id: `provider-target:${row.id}`,
        connectionId: row.connection_id,
        platform: 'threads' as const,
        status: 'published',
        displayName: row.display_name,
        handle: row.handle ?? undefined,
        format,
        fields: { caption: row.body },
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
