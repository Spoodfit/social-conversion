import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Inbox publication context patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

function replaceSection(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Inbox publication context patch failed: ${label} section not found.`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

// 1) Shared event contract: comments can carry the publication they belong to.
const typesPath = 'src/shared/types.ts';
let types = fs.readFileSync(typesPath, 'utf8');
if (!types.includes('SC_INBOX_PUBLICATION_CONTEXT_TYPES_V1')) {
  const oldEvent = `export interface NormalizedSocialEvent {\n  id: string;\n  externalEventId: string;\n  platform: Platform;\n  workspaceId: string;\n  connectionId: string;\n  eventType: 'message' | 'comment';\n  externalContactId: string;\n  contactName: string;\n  text: string;\n  occurredAt: string;\n}`;
  const newEvent = `export interface SocialContentContext {\n  kind: 'publication';\n  externalContentId: string;\n  title?: string;\n  body?: string;\n  url?: string;\n  mediaType?: string;\n}\n\nexport interface NormalizedSocialEvent {\n  id: string;\n  externalEventId: string;\n  platform: Platform;\n  workspaceId: string;\n  connectionId: string;\n  eventType: 'message' | 'comment';\n  externalContactId: string;\n  contactName: string;\n  text: string;\n  occurredAt: string;\n  context?: SocialContentContext;\n}`;
  types = replaceOnce(types, oldEvent, newEvent, 'normalized social event type');
  types += '\n// SC_INBOX_PUBLICATION_CONTEXT_TYPES_V1\n';
  fs.writeFileSync(typesPath, types);
}

// 2) Instagram webhooks: retain the parent media id so real-time comments keep their context.
const eventsPath = 'src/shared/events.ts';
let events = fs.readFileSync(eventsPath, 'utf8');
if (!events.includes('SC_INBOX_PUBLICATION_CONTEXT_EVENTS_V1')) {
  events = replaceOnce(
    events,
    `      const id = asString(value?.id);\n      if (!externalContactId || !text || !id) continue;`,
    `      const id = asString(value?.id);\n      const media = asRecord(value?.media);\n      const mediaId = asString(media?.id);\n      if (!externalContactId || !text || !id) continue;`,
    'Meta comment media id',
  );
  events = replaceOnce(
    events,
    `        text,\n        occurredAt: new Date().toISOString(),\n      });`,
    `        text,\n        occurredAt: new Date().toISOString(),\n        context: mediaId ? { kind: 'publication', externalContentId: mediaId } : undefined,\n      });`,
    'Meta comment context payload',
  );
  events += '\n// SC_INBOX_PUBLICATION_CONTEXT_EVENTS_V1\n';
  fs.writeFileSync(eventsPath, events);
}

// 3) Provider catch-up sync: attach the actual Instagram post / YouTube video to every imported comment.
const providerPath = 'src/worker/provider-inbox-sync.ts';
let provider = fs.readFileSync(providerPath, 'utf8');
if (!provider.includes('SC_INBOX_PUBLICATION_CONTEXT_PROVIDER_V1')) {
  provider = replaceOnce(
    provider,
    `type InstagramComment = {\n  id?: unknown;\n  text?: unknown;\n  timestamp?: unknown;\n  from?: { id?: unknown; username?: unknown };\n};`,
    `type InstagramComment = {\n  id?: unknown;\n  text?: unknown;\n  timestamp?: unknown;\n  from?: { id?: unknown; username?: unknown };\n};\n\ntype InstagramMedia = {\n  id?: unknown;\n  caption?: unknown;\n  media_type?: unknown;\n  permalink?: unknown;\n  timestamp?: unknown;\n};`,
    'Instagram media shape',
  );

  provider = replaceSection(
    provider,
    'export function normalizeInstagramComments(',
    'export function normalizeYouTubeCommentThreads(',
    `export function normalizeInstagramComments(\n  connection: { id: string },\n  workspaceId: string,\n  comments: InstagramComment[],\n  context?: NormalizedSocialEvent['context'],\n): NormalizedSocialEvent[] {\n  const events: NormalizedSocialEvent[] = [];\n  for (const comment of comments) {\n    const commentId = stringValue(comment.id, 200);\n    const text = stringValue(comment.text);\n    const authorId = stringValue(comment.from?.id, 200);\n    const username = stringValue(comment.from?.username, 100);\n    if (!commentId || !text || !authorId) continue;\n    events.push({\n      id: \`\${connection.id}:\${commentId}\`,\n      externalEventId: commentId,\n      platform: 'instagram',\n      workspaceId,\n      connectionId: connection.id,\n      eventType: 'comment',\n      externalContactId: authorId,\n      contactName: username ? \`@\${username}\` : \`Contact \${authorId.slice(-4)}\`,\n      text,\n      occurredAt: isoDate(comment.timestamp) ?? new Date().toISOString(),\n      context,\n    });\n  }\n  return events;\n}\n\n`,
    'Instagram comment normalizer',
  );

  provider = replaceSection(
    provider,
    'export function normalizeYouTubeCommentThreads(',
    'async function syncInstagramComments(',
    `export function normalizeYouTubeCommentThreads(\n  connection: { id: string },\n  workspaceId: string,\n  threads: YouTubeCommentThread[],\n  context?: NormalizedSocialEvent['context'],\n): NormalizedSocialEvent[] {\n  const events: NormalizedSocialEvent[] = [];\n  for (const thread of threads) {\n    const topLevel = thread.snippet?.topLevelComment;\n    const snippet = topLevel?.snippet;\n    const commentId = stringValue(topLevel?.id, 200);\n    const text = stringValue(snippet?.textOriginal);\n    const authorName = stringValue(snippet?.authorDisplayName, 180);\n    const authorChannelId = stringValue(snippet?.authorChannelId?.value, 200);\n    if (!commentId || !text) continue;\n    const externalContactId = authorChannelId || \`comment:\${commentId}\`;\n    events.push({\n      id: \`\${connection.id}:youtube-comment:\${commentId}\`,\n      externalEventId: commentId,\n      platform: 'youtube',\n      workspaceId,\n      connectionId: connection.id,\n      eventType: 'comment',\n      externalContactId,\n      contactName: authorName || 'Utilisateur YouTube',\n      text,\n      occurredAt: isoDate(snippet?.publishedAt) ?? new Date().toISOString(),\n      context,\n    });\n  }\n  return events;\n}\n\n`,
    'YouTube comment normalizer',
  );

  provider = replaceSection(
    provider,
    'async function syncInstagramComments(',
    'async function refreshYouTubeAccessToken(',
    `async function syncInstagramComments(\n  db: D1Database,\n  env: Env,\n  workspaceId: string,\n  connection: ConnectionRow,\n  fetchImpl: typeof fetch,\n): Promise<number> {\n  const keyring = tokenKeyringSecret(env);\n  const version = graphVersion(env);\n  if (!keyring || !version) throw new Error('Instagram inbox sync configuration is incomplete.');\n  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connection.id);\n  if (!tokens || tokens.credentials.provider !== 'instagram') throw new Error('Instagram credentials are unavailable.');\n  if (!tokens.credentials.scopes.includes('instagram_business_manage_comments')) {\n    throw new Error('Instagram comment permission is missing. Reconnect the account.');\n  }\n\n  const mediaUrl = new URL(\`https://graph.instagram.com/\${version}/me/media\`);\n  mediaUrl.searchParams.set('fields', 'id,caption,media_type,permalink,timestamp');\n  mediaUrl.searchParams.set('limit', String(MAX_INSTAGRAM_MEDIA));\n  const mediaResponse = await providerGet(fetchImpl, mediaUrl.toString(), tokens.accessToken);\n  if (!mediaResponse.ok) throw new Error(\`Instagram media request failed (\${mediaResponse.status}).\`);\n  const mediaPayload = await readJson(mediaResponse) as { data?: unknown };\n  const media = (Array.isArray(mediaPayload.data) ? mediaPayload.data : [])\n    .map((item) => item && typeof item === 'object' ? item as InstagramMedia : undefined)\n    .filter((item): item is InstagramMedia => Boolean(item))\n    .slice(0, MAX_INSTAGRAM_MEDIA);\n\n  let persisted = 0;\n  await mapInBatches(media, async (item) => {\n    const mediaId = stringValue(item.id, 200);\n    if (!mediaId) return;\n    const body = stringValue(item.caption);\n    const title = body.split(/\\r?\\n/)[0]?.slice(0, 220) || 'Publication Instagram';\n    const context: NonNullable<NormalizedSocialEvent['context']> = {\n      kind: 'publication',\n      externalContentId: mediaId,\n      title,\n      body: body || undefined,\n      url: stringValue(item.permalink, 2_000) || undefined,\n      mediaType: stringValue(item.media_type, 80) || undefined,\n    };\n    const commentsUrl = new URL(\`https://graph.instagram.com/\${version}/\${encodeURIComponent(mediaId)}/comments\`);\n    commentsUrl.searchParams.set('fields', 'id,text,timestamp,from{id,username}');\n    commentsUrl.searchParams.set('limit', '100');\n    const response = await providerGet(fetchImpl, commentsUrl.toString(), tokens.accessToken);\n    if (response.status === 400 || response.status === 403) return;\n    if (!response.ok) throw new Error(\`Instagram comments request failed (\${response.status}).\`);\n    const payload = await readJson(response) as { data?: unknown };\n    const comments = Array.isArray(payload.data) ? payload.data as InstagramComment[] : [];\n    for (const event of normalizeInstagramComments(connection, workspaceId, comments, context)) {\n      const result = await persistSocialEvent(db, event);\n      if (result === 'created') persisted += 1;\n    }\n  });\n  return persisted;\n}\n\n`,
    'Instagram comment sync',
  );

  provider = replaceSection(
    provider,
    'async function syncYouTubeComments(',
    'export async function syncWorkspaceProviderComments(',
    `async function syncYouTubeComments(\n  db: D1Database,\n  env: Env,\n  workspaceId: string,\n  connection: ConnectionRow,\n  fetchImpl: typeof fetch,\n): Promise<number> {\n  let accessToken = await youtubeAccessToken(db, env, workspaceId, connection.id, fetchImpl);\n  const videos = await db.prepare(\n    \`SELECT external_id, body, media_type, external_url\n     FROM planner_remote_posts\n     WHERE workspace_id = ? AND connection_id = ? AND platform = 'youtube' AND provider_status = 'published'\n     ORDER BY event_at DESC\n     LIMIT ?\`,\n  ).bind(workspaceId, connection.id, MAX_YOUTUBE_VIDEOS).all<{ external_id: string; body: string; media_type: string | null; external_url: string | null }>();\n  let persisted = 0;\n\n  await mapInBatches(videos.results, async ({ external_id: videoId, body, media_type: mediaType, external_url: externalUrl }) => {\n    const title = body.split(/\\r?\\n/)[0]?.slice(0, 220) || 'Vidéo YouTube';\n    const context: NonNullable<NormalizedSocialEvent['context']> = {\n      kind: 'publication',\n      externalContentId: videoId,\n      title,\n      body: body || undefined,\n      url: externalUrl || \`https://www.youtube.com/watch?v=\${encodeURIComponent(videoId)}\`,\n      mediaType: mediaType || 'VIDEO',\n    };\n    const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');\n    url.searchParams.set('part', 'snippet');\n    url.searchParams.set('videoId', videoId);\n    url.searchParams.set('maxResults', '100');\n    url.searchParams.set('order', 'time');\n    url.searchParams.set('textFormat', 'plainText');\n    let response = await providerGet(fetchImpl, url.toString(), accessToken);\n    if (response.status === 401) {\n      accessToken = await refreshYouTubeAccessToken(db, env, workspaceId, connection.id, fetchImpl);\n      response = await providerGet(fetchImpl, url.toString(), accessToken);\n    }\n    if (response.status === 403 || response.status === 404) return;\n    if (!response.ok) throw new Error(\`YouTube comments request failed (\${response.status}).\`);\n    const payload = await readJson(response) as { items?: unknown };\n    const threads = Array.isArray(payload.items) ? payload.items as YouTubeCommentThread[] : [];\n    for (const event of normalizeYouTubeCommentThreads(connection, workspaceId, threads, context)) {\n      const result = await persistSocialEvent(db, event);\n      if (result === 'created') persisted += 1;\n    }\n  });\n  return persisted;\n}\n\n`,
    'YouTube comment sync',
  );

  provider += '\n// SC_INBOX_PUBLICATION_CONTEXT_PROVIDER_V1\n';
  fs.writeFileSync(providerPath, provider);
}

// 4) Persistence: store a sanitized publication snapshot and refresh it on duplicate comment catch-up.
const persistencePath = 'src/worker/persistence.ts';
let persistence = fs.readFileSync(persistencePath, 'utf8');
if (!persistence.includes('SC_INBOX_PUBLICATION_CONTEXT_PERSISTENCE_V1')) {
  const start = persistence.indexOf('export async function persistSocialEvent');
  if (start < 0) throw new Error('Inbox publication context patch failed: persistence function not found.');
  persistence = persistence.slice(0, start) + `type StoredContentContext = NonNullable<NormalizedSocialEvent['context']>;\n\ntype RemoteContextRow = {\n  body: string;\n  media_type: string | null;\n  external_url: string | null;\n};\n\nfunction cleanText(value: string | undefined, maximum: number): string | undefined {\n  const text = value?.trim();\n  return text ? text.slice(0, maximum) : undefined;\n}\n\nfunction safeHttpsUrl(value: string | undefined): string | undefined {\n  if (!value) return undefined;\n  try {\n    const url = new URL(value);\n    return url.protocol === 'https:' ? url.toString() : undefined;\n  } catch {\n    return undefined;\n  }\n}\n\nasync function resolveContentContext(db: D1Database, event: NormalizedSocialEvent): Promise<StoredContentContext | undefined> {\n  const input = event.context;\n  if (!input || input.kind !== 'publication') return undefined;\n  const externalContentId = cleanText(input.externalContentId, 300);\n  if (!externalContentId) return undefined;\n\n  let remote: RemoteContextRow | undefined;\n  if (!input.title && !input.body && !input.url) {\n    try {\n      remote = await db.prepare(\n        \`SELECT body, media_type, external_url FROM planner_remote_posts\n         WHERE workspace_id = ? AND connection_id = ? AND platform = ? AND external_id = ?\n         LIMIT 1\`,\n      ).bind(event.workspaceId, event.connectionId, event.platform, externalContentId).first<RemoteContextRow>();\n    } catch {\n      remote = undefined;\n    }\n  }\n\n  const body = cleanText(input.body ?? remote?.body, 5_000);\n  const title = cleanText(input.title, 300) ?? cleanText(body?.split(/\\r?\\n/)[0], 300) ?? (event.platform === 'youtube' ? 'Vidéo YouTube' : 'Publication Instagram');\n  return {\n    kind: 'publication',\n    externalContentId,\n    title,\n    body,\n    url: safeHttpsUrl(input.url ?? remote?.external_url ?? undefined),\n    mediaType: cleanText(input.mediaType ?? remote?.media_type ?? undefined, 80),\n  };\n}\n\nexport async function persistSocialEvent(db: D1Database, event: NormalizedSocialEvent): Promise<'created' | 'duplicate'> {\n  const receivedAt = new Date().toISOString();\n  const contentContext = await resolveContentContext(db, event);\n  const contextJson = contentContext ? JSON.stringify(contentContext) : null;\n  const contactId = \`\${event.workspaceId}:\${event.platform}:\${event.externalContactId}\`;\n  const conversationId = \`\${event.connectionId}:\${contactId}\`;\n  const results = await db.batch([\n    db\n      .prepare(\n        \`INSERT OR IGNORE INTO webhook_events\n          (id, workspace_id, connection_id, external_event_id, platform, event_type, payload_json, received_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?)\`,\n      )\n      .bind(\n        event.id,\n        event.workspaceId,\n        event.connectionId,\n        event.externalEventId,\n        event.platform,\n        event.eventType,\n        JSON.stringify({ occurredAt: event.occurredAt }),\n        receivedAt,\n      ),\n    db\n      .prepare(\n        \`INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at\`,\n      )\n      .bind(\n        contactId,\n        event.workspaceId,\n        event.externalContactId,\n        event.platform,\n        event.contactName,\n        event.occurredAt,\n        event.occurredAt,\n      ),\n    db\n      .prepare(\n        \`INSERT INTO conversations\n          (id, workspace_id, connection_id, contact_id, status, lead_stage, last_message_at, created_at, updated_at)\n         VALUES (?, ?, ?, ?, 'open', 'Nouveau', ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET last_message_at = excluded.last_message_at, updated_at = excluded.updated_at\`,\n      )\n      .bind(\n        conversationId,\n        event.workspaceId,\n        event.connectionId,\n        contactId,\n        event.occurredAt,\n        event.occurredAt,\n        event.occurredAt,\n      ),\n    db\n      .prepare(\n        \`INSERT OR IGNORE INTO messages\n          (id, conversation_id, external_id, direction, message_type, body, context_json, sent_at, created_at)\n         VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?)\`,\n      )\n      .bind(\n        event.id,\n        conversationId,\n        event.id,\n        event.eventType,\n        event.text,\n        contextJson,\n        event.occurredAt,\n        event.occurredAt,\n      ),\n    ...(contextJson ? [\n      db.prepare('UPDATE messages SET context_json = ? WHERE id = ? OR external_id = ?').bind(contextJson, event.id, event.id),\n    ] : []),\n    db\n      .prepare('UPDATE webhook_events SET processed_at = ? WHERE id = ?')\n      .bind(receivedAt, event.id),\n  ]);\n\n  return (results[0]?.meta.changes ?? 0) === 0 ? 'duplicate' : 'created';\n}\n\n// SC_INBOX_PUBLICATION_CONTEXT_PERSISTENCE_V1\n`;
  fs.writeFileSync(persistencePath, persistence);
}

// 5) Inbox API: expose the linked publication on the conversation preview and each message.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_INBOX_PUBLICATION_CONTEXT_LIVE_DATA_V1')) {
  liveData = replaceOnce(
    liveData,
    `  latest_message_type: string | null;\n  latest_message_sent_at: string | null;`,
    `  latest_message_type: string | null;\n  latest_message_context_json: string | null;\n  latest_message_sent_at: string | null;`,
    'latest message context row',
  );
  liveData = replaceOnce(
    liveData,
    `  message_type: string;\n  body: string;\n  status: string;`,
    `  message_type: string;\n  body: string;\n  context_json: string | null;\n  status: string;`,
    'message context row',
  );
  liveData = replaceOnce(
    liveData,
    `export async function listInboxConversations(`,
    `type InboxContentContext = {\n  kind: 'publication';\n  externalContentId: string;\n  title?: string;\n  body?: string;\n  url?: string;\n  mediaType?: string;\n};\n\nfunction parseContentContext(value: string | null): InboxContentContext | undefined {\n  if (!value) return undefined;\n  try {\n    const parsed = JSON.parse(value) as Partial<InboxContentContext>;\n    if (parsed.kind !== 'publication' || typeof parsed.externalContentId !== 'string' || !parsed.externalContentId) return undefined;\n    const stringOrUndefined = (candidate: unknown, maximum: number) => typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, maximum) : undefined;\n    return {\n      kind: 'publication',\n      externalContentId: parsed.externalContentId.slice(0, 300),\n      title: stringOrUndefined(parsed.title, 300),\n      body: stringOrUndefined(parsed.body, 5_000),\n      url: stringOrUndefined(parsed.url, 2_000),\n      mediaType: stringOrUndefined(parsed.mediaType, 80),\n    };\n  } catch {\n    return undefined;\n  }\n}\n\nexport async function listInboxConversations(`,
    'context JSON parser',
  );
  liveData = replaceOnce(
    liveData,
    `       (SELECT m.message_type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_type,\n       (SELECT m.sent_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_sent_at`,
    `       (SELECT m.message_type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_type,\n       (SELECT m.context_json FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_context_json,\n       (SELECT m.sent_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_sent_at`,
    'latest message context select',
  );
  liveData = replaceOnce(
    liveData,
    `        type: row.latest_message_type ?? 'message',\n        sentAt: row.latest_message_sent_at,`,
    `        type: row.latest_message_type ?? 'message',\n        context: parseContentContext(row.latest_message_context_json),\n        sentAt: row.latest_message_sent_at,`,
    'latest message context response',
  );
  liveData = replaceOnce(
    liveData,
    `    \`SELECT m.id, m.external_id, m.direction, m.message_type, m.body,\n            m.status, m.ai_assisted, m.sent_at, m.created_at`,
    `    \`SELECT m.id, m.external_id, m.direction, m.message_type, m.body, m.context_json,\n            m.status, m.ai_assisted, m.sent_at, m.created_at`,
    'message context select',
  );
  liveData = replaceOnce(
    liveData,
    `      body: row.body,\n      status: row.status,`,
    `      body: row.body,\n      context: parseContentContext(row.context_json),\n      status: row.status,`,
    'message context response',
  );
  liveData += '\n// SC_INBOX_PUBLICATION_CONTEXT_LIVE_DATA_V1\n';
  fs.writeFileSync(liveDataPath, liveData);
}

// 6) UI: make the related publication obvious before replying to a comment.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_INBOX_PUBLICATION_CONTEXT_UI_V1')) {
  app = replaceOnce(
    app,
    `type InboxPayload = {\n  conversations: LiveConversation[];\n  page: { limit: number; hasMore: boolean; nextCursor?: string };\n};`,
    `type InboxPayload = {\n  conversations: LiveConversation[];\n  page: { limit: number; hasMore: boolean; nextCursor?: string };\n};\n\ntype MessageContext = {\n  kind: 'publication';\n  externalContentId: string;\n  title?: string;\n  body?: string;\n  url?: string;\n  mediaType?: string;\n};`,
    'UI message context type',
  );
  app = replaceOnce(
    app,
    `    type: string;\n    sentAt: string;\n  };`,
    `    type: string;\n    context?: MessageContext;\n    sentAt: string;\n  };`,
    'conversation latest context type',
  );
  app = replaceOnce(
    app,
    `  type: string;\n  body: string;\n  status: string;`,
    `  type: string;\n  body: string;\n  context?: MessageContext;\n  status: string;`,
    'thread message context type',
  );
  app = replaceOnce(
    app,
    `function formatBytes(value: number) {`,
    `function contentContextTitle(context?: MessageContext) {\n  const raw = context?.title?.trim() || context?.body?.trim().split(/\\r?\\n/)[0] || 'Publication liée';\n  return raw.length > 92 ? \`\${raw.slice(0, 89)}…\` : raw;\n}\n\nfunction contentContextExcerpt(context?: MessageContext) {\n  const body = context?.body?.trim();\n  if (!body) return '';\n  const title = context?.title?.trim();\n  const compact = body.replace(/\\s+/g, ' ').trim();\n  const withoutTitle = title && compact.toLowerCase().startsWith(title.toLowerCase()) ? compact.slice(title.length).replace(/^[-–—:|\\s]+/, '') : compact;\n  const value = withoutTitle || compact;\n  return value.length > 170 ? \`\${value.slice(0, 167)}…\` : value;\n}\n\nfunction formatBytes(value: number) {`,
    'context display helpers',
  );
  app = replaceOnce(
    app,
    `<span><strong>{conversation.contactName}</strong><small>{conversation.latestMessage?.body || 'Conversation ouverte'}</small><em><PlatformMark platform={conversation.platform} size={12} /> {conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}</em></span>`,
    `<span><strong>{conversation.contactName}</strong><small>{conversation.latestMessage?.body || 'Conversation ouverte'}</small><em><PlatformMark platform={conversation.platform} size={12} /> {conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}</em>{conversation.latestMessage?.type === 'comment' && conversation.latestMessage.context && <i className="sc19-row-context">Sur · {contentContextTitle(conversation.latestMessage.context)}</i>}</span>`,
    'conversation publication preview',
  );
  app = replaceOnce(
    app,
    `{messages && [...messages.messages].reverse().map((message) => <div key={message.id} className={\`sc3-message \${message.direction}\`}><p>{message.body}</p><small>{formatShortDate(message.sentAt)}{message.aiAssisted ? ' · IA' : ''}</small></div>)}`,
    `{messages && [...messages.messages].reverse().map((message) => {\n                const excerpt = contentContextExcerpt(message.context);\n                return <div key={message.id} className={\`sc19-message-group \${message.direction}\`}>\n                  {message.type === 'comment' && message.context && <div className="sc19-context-card">\n                    <PlatformMark platform={selected.platform} size={14} />\n                    <span className="sc19-context-copy">\n                      <small className="sc19-context-label"><MessageCircle size={11} /> Commentaire sur {platformLabel(selected.platform)}</small>\n                      <strong>{contentContextTitle(message.context)}</strong>\n                      {excerpt && <span>{excerpt}</span>}\n                    </span>\n                    {message.context.url && <a className="sc19-context-link" href={message.context.url} target="_blank" rel="noreferrer">Voir la publication <Eye size={12} /></a>}\n                  </div>}\n                  <div className={\`sc3-message \${message.direction}\`}><p>{message.body}</p><small>{formatShortDate(message.sentAt)}{message.aiAssisted ? ' · IA' : ''}</small></div>\n                </div>;\n              })}`,
    'thread publication context cards',
  );
  app += '\n// SC_INBOX_PUBLICATION_CONTEXT_UI_V1\n';
  fs.writeFileSync(appPath, app);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./inbox-publication-context.css")) {
  main += `\nimport './inbox-publication-context.css';\n`;
  fs.writeFileSync(mainPath, main);
}

console.log('Inbox publication context retained, exposed and rendered.');
