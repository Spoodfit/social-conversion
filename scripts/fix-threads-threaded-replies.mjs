import fs from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Threads threaded replies patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Runtime: one Inbox conversation per source Thread, not one giant conversation per author.
const runtimePath = 'src/worker/threads-runtime-sync.ts';
let runtime = fs.readFileSync(runtimePath, 'utf8');
if (!runtime.includes('SC_THREADS_THREADED_REPLIES_RUNTIME_V1')) {
  runtime = replaceRequired(
    runtime,
    `  const contactId = \`${'${connection.workspace_id}'}:threads:${'${externalContactId}'}\`;\n  const conversationId = \`${'${connection.id}'}:${'${contactId}'}\`;\n  const messageId = \`threads:${'${connection.id}'}:${'${input.itemId}'}\`;`,
    `  const contactId = \`${'${connection.workspace_id}'}:threads:${'${externalContactId}'}\`;\n  const messageId = \`threads:${'${connection.id}'}:${'${input.itemId}'}\`;`,
    'legacy author-level conversation id',
  );

  runtime = replaceRequired(
    runtime,
    `  const sourceId = input.rootPostId ?? input.itemId;\n  const sourceBody = (input.sourceBody ?? '').trim();`,
    `  const sourceId = input.rootPostId ?? input.itemId;\n  const conversationId = \`${'${connection.id}'}:${'${contactId}'}:thread:${'${sourceId}'}\`;\n  const sourceBody = (input.sourceBody ?? '').trim();`,
    'source thread conversation id',
  );

  runtime = replaceRequired(
    runtime,
    `       ON CONFLICT(id) DO UPDATE SET\n         body = excluded.body,\n         sent_at = excluded.sent_at,\n         context_json = excluded.context_json`,
    `       ON CONFLICT(id) DO UPDATE SET\n         conversation_id = excluded.conversation_id,\n         body = excluded.body,\n         sent_at = excluded.sent_at,\n         context_json = excluded.context_json`,
    'move existing messages into source-thread conversation',
  );

  const syncOneAnchor = `async function syncOneConnection(\n  db: D1Database,`;
  if (!runtime.includes(syncOneAnchor)) throw new Error('Threads threaded replies patch failed: syncOneConnection anchor not found.');
  runtime = runtime.replace(syncOneAnchor, `async function pruneEmptyThreadsConversations(db: D1Database, connection: ThreadsConnectionRow) {\n  await db.prepare(\n    \`DELETE FROM conversations\n     WHERE workspace_id = ? AND connection_id = ?\n       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id)\`,\n  ).bind(connection.workspace_id, connection.id).run();\n}\n\n${syncOneAnchor}`);

  runtime = replaceRequired(
    runtime,
    `  } catch (error) {\n    errors.push(\`token: ${'${error instanceof Error ? error.message : \'unknown\'}'}\`);\n  }\n  await markResult(db, connection, errors);`,
    `  } catch (error) {\n    errors.push(\`token: ${'${error instanceof Error ? error.message : \'unknown\'}'}\`);\n  }\n  await pruneEmptyThreadsConversations(db, connection).catch(() => undefined);\n  await markResult(db, connection, errors);`,
    'prune old mixed conversations',
  );

  runtime += `\n\nexport class ThreadsReplyError extends Error {\n  readonly code: 'THREADS_REPLY_INVALID' | 'THREADS_REPLY_NOT_FOUND' | 'THREADS_REPLY_SCOPE_MISSING' | 'THREADS_REPLY_PROVIDER_FAILED';\n  constructor(code: ThreadsReplyError['code'], message: string) { super(message); this.name = 'ThreadsReplyError'; this.code = code; }\n}\n\ntype ThreadsReplyTargetRow = ThreadsConnectionRow & {\n  conversation_id: string;\n  message_id: string;\n  message_external_id: string | null;\n  message_context_json: string | null;\n};\n\nfunction rawThreadsInteractionId(value: string | null, fallback: string): string {\n  const raw = (value || fallback).trim();\n  const tail = raw.includes(':') ? raw.split(':').at(-1) ?? '' : raw;\n  if (!/^[A-Za-z0-9_-]{3,300}$/.test(tail)) throw new ThreadsReplyError('THREADS_REPLY_INVALID', 'La réponse Threads sélectionnée est invalide.');\n  return tail;\n}\n\nexport async function replyToThreadsInteraction(\n  db: D1Database,\n  env: Env,\n  workspaceId: string,\n  conversationId: string,\n  messageId: string,\n  message: string,\n  fetchImpl: typeof fetch = fetch,\n) {\n  const body = message.trim();\n  if (!body || body.length > 500) throw new ThreadsReplyError('THREADS_REPLY_INVALID', 'La réponse Threads doit contenir entre 1 et 500 caractères.');\n  const row = await db.prepare(\n    \`SELECT tc.id, tc.workspace_id, tc.external_account_id, tc.display_name, tc.handle,\n            tc.access_token_ciphertext, tc.access_token_iv, tc.access_key_version, tc.scopes_json,\n            c.id AS conversation_id, m.id AS message_id, m.external_id AS message_external_id, m.context_json AS message_context_json\n     FROM messages m\n     JOIN conversations c ON c.id = m.conversation_id\n     JOIN threads_connections tc ON tc.id = c.connection_id AND tc.workspace_id = c.workspace_id\n     WHERE c.workspace_id = ? AND c.id = ? AND m.id = ? AND tc.status = 'connected'\n       AND m.direction = 'inbound' AND m.message_type = 'comment'\n     LIMIT 1\`,\n  ).bind(workspaceId, conversationId, messageId).first<ThreadsReplyTargetRow>();\n  if (!row) throw new ThreadsReplyError('THREADS_REPLY_NOT_FOUND', 'Cette réponse Threads n’est plus disponible. Actualisez l’Inbox.');\n  const scopes = parseScopes(row.scopes_json);\n  if (!scopes.includes('threads_content_publish')) {\n    throw new ThreadsReplyError('THREADS_REPLY_SCOPE_MISSING', 'Reconnectez Threads pour autoriser les réponses (threads_content_publish).');\n  }\n  const token = await accessToken(env, row);\n  const targetId = rawThreadsInteractionId(row.message_external_id, row.message_id);\n  const url = new URL(\`${'${API_HOST}'}/me/threads\`);\n  url.searchParams.set('media_type', 'TEXT');\n  url.searchParams.set('text', body);\n  url.searchParams.set('reply_to_id', targetId);\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), 15_000);\n  let response: Response;\n  try {\n    response = await fetchImpl(url.toString(), {\n      method: 'POST',\n      headers: { authorization: \`Bearer ${'${token}'}\` },\n      signal: controller.signal,\n    });\n  } finally {\n    clearTimeout(timeout);\n  }\n  const responseText = await response.text().catch(() => '');\n  if (!response.ok) {\n    throw new ThreadsReplyError('THREADS_REPLY_PROVIDER_FAILED', \`Threads a refusé la réponse (HTTP ${'${response.status}'})${'${responseText ? `: ${responseText.slice(0, 400)}` : \'\'}'}\`);\n  }\n  let providerId = '';\n  try { providerId = text((JSON.parse(responseText) as { id?: unknown }).id, 300); } catch { providerId = ''; }\n  if (!providerId) throw new ThreadsReplyError('THREADS_REPLY_PROVIDER_FAILED', 'Threads n’a pas renvoyé l’identifiant de la réponse publiée.');\n  const now = new Date().toISOString();\n  await db.batch([\n    db.prepare(\n      \`INSERT INTO messages (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at, context_json)\n       VALUES (?, ?, ?, 'outbound', 'comment', ?, 'sent', ?, ?, ?)\`,\n    ).bind(\`threads-out:${'${row.id}'}:${'${providerId}'}\`, conversationId, providerId, body, now, now, row.message_context_json),\n    db.prepare(\n      \`UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?\`,\n    ).bind(now, now, conversationId, workspaceId),\n  ]);\n  return { sent: true, id: providerId, replyToId: targetId };\n}\n\n// SC_THREADS_THREADED_REPLIES_RUNTIME_V1\n`;
  fs.writeFileSync(runtimePath, runtime);
}

// 2) Production route: targeted reply to the selected Threads interaction.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('SC_THREADS_THREADED_REPLIES_PRODUCTION_V1')) {
  production = replaceRequired(
    production,
    `import { syncAllThreadsRuntime } from './threads-runtime-sync';`,
    `import { replyToThreadsInteraction, syncAllThreadsRuntime, ThreadsReplyError } from './threads-runtime-sync';`,
    'Threads runtime production import',
  );

  const handlerAnchor = `async function dispatchPending(env: Env): Promise<number> {`;
  if (!production.includes(handlerAnchor)) throw new Error('Threads threaded replies patch failed: dispatch handler anchor not found.');
  const handler = `async function handleThreadsReply(request: Request, env: Env): Promise<Response> {\n  const auth = await authenticateMutation(request, env, '/api/threads/replies');\n  if (!auth.ok) return auth.response;\n  if (!isLive(env)) return Response.json({ error: 'Threads replies are unavailable while live mode is disabled.', code: 'LIVE_NOT_READY' }, { status: 503 });\n  const payload = await request.json().catch(() => undefined) as { conversationId?: unknown; messageId?: unknown; message?: unknown } | undefined;\n  if (!payload || typeof payload.conversationId !== 'string' || typeof payload.messageId !== 'string' || typeof payload.message !== 'string') {\n    return Response.json({ error: 'conversationId, messageId and message are required.', code: 'INVALID_REQUEST' }, { status: 400 });\n  }\n  try {\n    const result = await replyToThreadsInteraction(env.DB, env, auth.principal.workspaceId, payload.conversationId, payload.messageId, payload.message);\n    await writeAuditLog(env.DB, auth.principal, 'threads.reply_sent', 'conversation', payload.conversationId, { targetMessageId: payload.messageId });\n    return Response.json(result);\n  } catch (error) {\n    if (error instanceof ThreadsReplyError) {\n      const status = error.code === 'THREADS_REPLY_NOT_FOUND' ? 404 : error.code === 'THREADS_REPLY_SCOPE_MISSING' ? 409 : error.code === 'THREADS_REPLY_PROVIDER_FAILED' ? 502 : 400;\n      return Response.json({ error: error.message, code: error.code }, { status });\n    }\n    throw error;\n  }\n}\n\n`;
  production = production.replace(handlerAnchor, handler + handlerAnchor);

  production = replaceRequired(
    production,
    `    if (url.pathname === '/api/messages' && request.method === 'POST') {\n      return handleOutboundApi(request, env);\n    }`,
    `    if (url.pathname === '/api/threads/replies' && request.method === 'POST') {\n      return handleThreadsReply(request, env);\n    }\n    if (url.pathname === '/api/messages' && request.method === 'POST') {\n      return handleOutboundApi(request, env);\n    }`,
    'Threads reply production route',
  );

  production += '\n// SC_THREADS_THREADED_REPLIES_PRODUCTION_V1\n';
  fs.writeFileSync(productionPath, production);
}

// 3) UI: keep the reply box visible and let the operator select the exact reply to answer.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_THREADS_THREADED_REPLIES_UI_V1')) {
  app = replaceRequired(
    app,
    `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);`,
    `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);\n  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string>();`,
    'reply target state',
  );

  app = replaceRequired(
    app,
    `    if (!workspaceId || !selectedConversationId) {\n      setMessages(undefined);\n      return undefined;\n    }`,
    `    if (!workspaceId || !selectedConversationId) {\n      setMessages(undefined);\n      setReplyTargetMessageId(undefined);\n      return undefined;\n    }`,
    'clear target without conversation',
  );

  app = replaceRequired(
    app,
    `      .then((payload) => active && setMessages(payload))`,
    `      .then((payload) => {\n        if (!active) return;\n        setMessages(payload);\n        const newestInbound = payload.messages.find((message) => message.direction === 'inbound' && message.type === 'comment');\n        setReplyTargetMessageId(newestInbound?.id);\n      })`,
    'default latest Threads reply target',
  );

  const sendAnchor = `    if (!workspaceId || !selectedConversation || !reply.trim() || replyBusy) return;`;
  app = replaceRequired(
    app,
    sendAnchor,
    `${sendAnchor}\n    if (selectedConversation.platform === 'threads') {\n      const targetMessageId = replyTargetMessageId ?? messages?.messages.find((message) => message.direction === 'inbound' && message.type === 'comment')?.id;\n      if (!targetMessageId) {\n        setToast('Sélectionnez la réponse Threads à laquelle répondre.');\n        return;\n      }\n      setReplyBusy(true);\n      try {\n        await apiRequest('/api/threads/replies', {\n          method: 'POST',\n          body: JSON.stringify({ conversationId: selectedConversation.id, messageId: targetMessageId, message: reply.trim() }),\n        }, workspaceId);\n        setReply('');\n        setToast('Réponse Threads envoyée.');\n        setRefreshIndex((value) => value + 1);\n      } catch (error) {\n        setToast(readableError(error));\n      } finally {\n        setReplyBusy(false);\n      }\n      return;\n    }`,
    'Threads targeted send branch',
  );

  app = replaceRequired(
    app,
    `              reply={reply}\n              outboundReady={runtime.outboundReady}`,
    `              reply={reply}\n              replyTargetMessageId={replyTargetMessageId}\n              outboundReady={runtime.outboundReady}`,
    'Inbox reply target prop value',
  );
  app = replaceRequired(
    app,
    `              onReply={setReply}\n              onSend={sendReply}`,
    `              onReply={setReply}\n              onReplyTarget={setReplyTargetMessageId}\n              onSend={sendReply}`,
    'Inbox reply target callback',
  );

  app = app.replace(
    `function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onSend, onSuggest, onOpenPublication }: {`,
    `function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, replyTargetMessageId, outboundReady, aiReady, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onReplyTarget, onSend, onSuggest, onOpenPublication }: {`,
  );
  app = replaceRequired(
    app,
    `  reply: string;\n  outboundReady: boolean;`,
    `  reply: string;\n  replyTargetMessageId?: string;\n  outboundReady: boolean;`,
    'Inbox reply target prop type',
  );
  app = replaceRequired(
    app,
    `  onReply: (value: string) => void;\n  onSend: (event: FormEvent) => void;`,
    `  onReply: (value: string) => void;\n  onReplyTarget: (messageId: string) => void;\n  onSend: (event: FormEvent) => void;`,
    'Inbox reply target callback type',
  );

  const returnAnchor = `  return (\n    <div className="sc3-inbox-wrap">`;
  app = replaceRequired(
    app,
    returnAnchor,
    `  const replyTarget = messages?.messages.find((message) => message.id === replyTargetMessageId);\n  const threadsReplyReady = selected?.platform === 'threads' && Boolean(replyTarget);\n  const canSendReply = selected?.platform === 'threads' ? threadsReplyReady : outboundReady;\n\n${returnAnchor}`,
    'Inbox reply target derived state',
  );

  const messageBubble = `<div className={\`sc3-message ${'${message.direction}'}\`}><p>{message.body}</p><small>{formatShortDate(message.sentAt)}{message.aiAssisted ? ' · IA' : ''}</small></div>`;
  const messageBubbleWithReply = `<div className={\`sc3-message ${'${message.direction}'}\`}><p>{message.body}</p><small>{formatShortDate(message.sentAt)}{message.aiAssisted ? ' · IA' : ''}</small>{selected.platform === 'threads' && message.direction === 'inbound' && message.type === 'comment' && <button type="button" className={\`sc26-inline-reply${'${replyTargetMessageId === message.id ? \' active\' : \'\'}'}\`} onClick={() => onReplyTarget(message.id)}><MessageCircle size={11} /> {replyTargetMessageId === message.id ? 'Réponse sélectionnée' : 'Répondre à ce message'}</button>}</div>`;
  app = replaceRequired(app, messageBubble, messageBubbleWithReply, 'per-message Threads reply selector');

  const replyBlock = `<div className="sc3-reply">\n              {aiReady && <button onClick={onSuggest}><Sparkles size={15} /> Proposer une réponse</button>}\n              <form onSubmit={onSend}><textarea value={reply} onChange={(event) => onReply(event.target.value)} disabled={!outboundReady} placeholder={outboundReady ? 'Écrire une réponse…' : 'Réponse sortante non disponible pour ce compte'} /><button type="submit" disabled={!outboundReady || !reply.trim()}><Send size={17} /></button></form>\n            </div>`;
  const replyBlockNew = `<div className="sc3-reply sc26-sticky-reply">\n              {selected.platform === 'threads' && <div className="sc26-reply-target">\n                <span><small>Répondre précisément à</small><strong>{replyTarget ? replyTarget.body : 'Sélectionnez un message ci-dessus'}</strong></span>\n              </div>}\n              {aiReady && <button onClick={onSuggest}><Sparkles size={15} /> Proposer une réponse</button>}\n              <form onSubmit={onSend}><textarea value={reply} onChange={(event) => onReply(event.target.value)} disabled={!canSendReply} placeholder={selected.platform === 'threads' ? (replyTarget ? 'Répondre à ce message Threads…' : 'Sélectionnez le message auquel répondre') : outboundReady ? 'Écrire une réponse…' : 'Réponse sortante non disponible pour ce compte'} /><button type="submit" disabled={!canSendReply || !reply.trim()}><Send size={17} /></button></form>\n            </div>`;
  app = replaceRequired(app, replyBlock, replyBlockNew, 'sticky targeted reply composer');

  app += '\n/* SC_THREADS_THREADED_REPLIES_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

const cssPath = 'src/social-core.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('SC_THREADS_THREADED_REPLIES_CSS_V1')) {
  css += `\n\n/* SC_THREADS_THREADED_REPLIES_CSS_V1 */\n.sc3-inbox{height:calc(100vh - 176px);height:calc(100dvh - 176px);min-height:520px}.sc3-conversations{min-height:0;overflow:hidden}.sc3-conversation-list{min-height:0;flex:1 1 auto}.sc3-thread{height:100%;max-height:100%;min-height:0;overflow:hidden}.sc3-messages{min-height:0!important;max-height:none!important;overflow-y:auto!important}.sc26-sticky-reply{position:relative;z-index:12;box-shadow:0 -8px 24px rgba(20,22,58,.06)}.sc26-reply-target{margin-bottom:7px;padding:7px 9px;border:1px solid #e3ddfb;border-radius:10px;background:#f8f6ff;display:flex;align-items:center;gap:8px}.sc26-reply-target span{min-width:0;display:grid;gap:2px}.sc26-reply-target small{font-size:6px;color:#8a7db9;text-transform:uppercase;letter-spacing:.05em}.sc26-reply-target strong{max-width:720px;font-size:8px;color:#38334d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sc26-inline-reply{width:max-content;margin-top:4px;border:0;background:transparent;color:#7969b0;display:inline-flex;align-items:center;gap:4px;padding:3px 5px;border-radius:6px;font-size:7px;font-weight:800;cursor:pointer}.sc26-inline-reply:hover,.sc26-inline-reply.active{background:#f2efff;color:#6030d3}.sc26-inline-reply.active{box-shadow:inset 0 0 0 1px #ddd3fb}@media(max-width:900px){.sc3-inbox{height:auto;min-height:0}.sc3-thread{height:70dvh;max-height:70dvh}}\n`;
  fs.writeFileSync(cssPath, css);
}

console.log('Threads Inbox is split by source Thread, supports targeted replies, and keeps the composer visible.');
