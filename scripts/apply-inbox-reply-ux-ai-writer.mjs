import fs from 'node:fs';

function replaceOnce(source, before, after, label, optional = false) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    if (optional) return source;
    throw new Error(`Inbox reply/AI writer patch failed: ${label} anchor not found.`);
  }
  return source.replace(before, after);
}

// 1) Real YouTube comment replies: never report success before YouTube confirms it.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('SC_YOUTUBE_COMMENT_REPLY_V1')) {
  production = replaceOnce(
    production,
    `import { persistSocialEvent } from './persistence';`,
    `import { persistSocialEvent } from './persistence';\nimport { sendYouTubeCommentReply, YouTubeReplyError } from './youtube-comment-replies';`,
    'YouTube reply import',
  );

  production = replaceOnce(
    production,
    `  if (!instagramOutboundConfigured(env)) {\n    return Response.json({ error: 'Instagram outbound provider is not configured.', code: 'OUTBOUND_NOT_READY' }, { status: 503 });\n  }\n\n  const body = await request.json().catch(() => undefined) as {`,
    `  const body = await request.json().catch(() => undefined) as {`,
    'move Instagram readiness after provider detection',
  );

  const dispatchAnchor = `  try {\n    const outbox = await enqueueOutbound(env.DB, {`;
  const providerRouting = `  const conversation = await env.DB.prepare(\n    \`SELECT sc.platform\n     FROM conversations c\n     JOIN social_connections sc ON sc.id = c.connection_id AND sc.workspace_id = c.workspace_id\n     WHERE c.id = ? AND c.workspace_id = ?\`,\n  ).bind(body.conversationId, auth.principal.workspaceId).first<{ platform: string }>();\n\n  if (!conversation) {\n    return Response.json({ error: 'Conversation introuvable.', code: 'CONVERSATION_NOT_FOUND' }, { status: 404 });\n  }\n\n  if (conversation.platform === 'youtube') {\n    try {\n      const result = await sendYouTubeCommentReply(\n        env.DB,\n        env,\n        auth.principal.workspaceId,\n        body.conversationId,\n        body.message,\n      );\n      await writeAuditLog(env.DB, auth.principal, 'message.youtube_comment_replied', 'message', result.id, {\n        conversationId: body.conversationId,\n        providerId: result.providerId,\n      });\n      return Response.json(result, { status: 200 });\n    } catch (error) {\n      if (error instanceof YouTubeReplyError) {\n        const status = error.code === 'CONVERSATION_NOT_FOUND' ? 404\n          : error.code === 'NOT_YOUTUBE_COMMENT' || error.code === 'OAUTH_SCOPE_MISSING' ? 409\n            : error.code === 'OAUTH_NOT_READY' ? 503\n              : 502;\n        return Response.json({ error: error.message, code: error.code }, { status });\n      }\n      throw error;\n    }\n  }\n\n  if (!instagramOutboundConfigured(env)) {\n    return Response.json({ error: 'Le connecteur de réponse de ce réseau n’est pas disponible.', code: 'OUTBOUND_NOT_READY' }, { status: 503 });\n  }\n\n${dispatchAnchor}`;
  production = replaceOnce(production, dispatchAnchor, providerRouting, 'provider-aware outbound routing');
  production += '\n// SC_YOUTUBE_COMMENT_REPLY_V1\n';
  fs.writeFileSync(productionPath, production);
}

// 2) Keep YouTube profile pictures from commentThreads and expose them through the existing contact metadata pipeline.
const providerPath = 'src/worker/provider-inbox-sync.ts';
let provider = fs.readFileSync(providerPath, 'utf8');
if (!provider.includes('SC_YOUTUBE_CONTACT_AVATAR_V1')) {
  provider = replaceOnce(
    provider,
    `        authorDisplayName?: unknown;\n        textOriginal?: unknown;`,
    `        authorDisplayName?: unknown;\n        authorProfileImageUrl?: unknown;\n        textOriginal?: unknown;`,
    'YouTube author avatar shape',
  );

  const loopAnchor = `    for (const event of normalizeYouTubeCommentThreads(connection, workspaceId, threads, context)) {\n      const result = await persistSocialEvent(db, event);\n      if (result === 'created') persisted += 1;\n    }`;
  const enrichedLoop = `    for (const event of normalizeYouTubeCommentThreads(connection, workspaceId, threads, context)) {\n      const result = await persistSocialEvent(db, event);\n      if (result === 'created') persisted += 1;\n      const sourceThread = threads.find((thread) => stringValue(thread.snippet?.topLevelComment?.id, 200) === event.externalEventId);\n      const avatarUrl = stringValue(sourceThread?.snippet?.topLevelComment?.snippet?.authorProfileImageUrl, 2_000);\n      if (avatarUrl.startsWith('https://')) {\n        const contactId = \`${'${event.workspaceId}'}:${'${event.platform}'}:${'${event.externalContactId}'}\`;\n        await db.prepare(\n          \`UPDATE contacts\n           SET metadata_json = json_set(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.avatarUrl', ?), updated_at = ?\n           WHERE id = ? AND workspace_id = ?\`,\n        ).bind(avatarUrl, new Date().toISOString(), contactId, workspaceId).run();\n      }\n    }`;
  provider = replaceOnce(provider, loopAnchor, enrichedLoop, 'YouTube avatar persistence');
  provider += '\n// SC_YOUTUBE_CONTACT_AVATAR_V1\n';
  fs.writeFileSync(providerPath, provider);
}

// 3) Inbox UX: richer identity, deterministic send state, stable selection, and visible AI generation state.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_INBOX_REPLY_UX_V1')) {
  app = replaceOnce(
    app,
    `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);`,
    `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);\n  const [aiReplyBusy, setAiReplyBusy] = useState(false);`,
    'separate AI reply busy state',
  );

  const sendStart = app.indexOf('  async function sendReply(event: FormEvent) {');
  const suggestStart = app.indexOf('  async function suggestReply() {', sendStart);
  if (sendStart < 0 || suggestStart < 0) throw new Error('Inbox reply/AI writer patch failed: send/suggest functions not found.');
  const newSend = `  async function sendReply(event: FormEvent) {\n    event.preventDefault();\n    if (!workspaceId || !selectedConversation || !reply.trim() || replyBusy) return;\n    if (!runtime.outboundReady) {\n      setToast('L’envoi réel n’est pas disponible pour ce compte.');\n      return;\n    }\n    const submitted = reply.trim();\n    setReplyBusy(true);\n    try {\n      const result = await apiRequest<{ status: string; message?: ConversationMessage; id?: string }>('/api/messages', {\n        method: 'POST',\n        body: JSON.stringify({\n          conversationId: selectedConversation.id,\n          message: submitted,\n          idempotencyKey: crypto.randomUUID(),\n        }),\n      }, workspaceId);\n\n      if (result.status === 'sent' && result.message) {\n        setReply('');\n        setMessages((current) => current && current.conversationId === selectedConversation.id ? {\n          ...current,\n          messages: [result.message!, ...current.messages.filter((message) => message.id !== result.message!.id)],\n        } : current);\n        setInbox((current) => current ? {\n          ...current,\n          conversations: current.conversations.map((conversation) => conversation.id === selectedConversation.id ? {\n            ...conversation,\n            unread: false,\n            needsReply: false,\n            lastMessageAt: result.message!.sentAt,\n            updatedAt: result.message!.sentAt,\n            latestMessage: { body: result.message!.body, direction: 'outbound', type: result.message!.type, sentAt: result.message!.sentAt },\n          } : conversation),\n        } : current);\n        setToast('Réponse envoyée et confirmée par le réseau.');\n      } else {\n        setToast('Envoi en cours. La confirmation du réseau est encore attendue.');\n      }\n    } catch (error) {\n      setToast(readableError(error));\n    } finally {\n      setReplyBusy(false);\n    }\n  }\n\n`;
  app = app.slice(0, sendStart) + newSend + app.slice(suggestStart);

  const suggestStart2 = app.indexOf('  async function suggestReply() {');
  const openCreateStart = app.indexOf('  function openCreate(', suggestStart2);
  if (suggestStart2 < 0 || openCreateStart < 0) throw new Error('Inbox reply/AI writer patch failed: suggestReply section not found.');
  const newSuggest = `  async function suggestReply() {\n    if (!workspaceId || !selectedConversation || aiReplyBusy) return;\n    if (!runtime.aiReady) {\n      setToast('Le copilote IA n’est pas encore configuré.');\n      return;\n    }\n    setAiReplyBusy(true);\n    try {\n      const result = await apiRequest<AiDraftPayload>('/api/ai/suggest', {\n        method: 'POST',\n        body: JSON.stringify({ conversationId: selectedConversation.id }),\n      }, workspaceId);\n      setReply(result.draft.body);\n    } catch (error) {\n      setToast(readableError(error));\n    } finally {\n      setAiReplyBusy(false);\n    }\n  }\n\n`;
  app = app.slice(0, suggestStart2) + newSuggest + app.slice(openCreateStart);

  const oldSelectionEffect = `  useEffect(() => {\n    if (!visibleConversations.length) {\n      setSelectedConversationId(undefined);\n      return;\n    }\n    if (!visibleConversations.some((conversation) => conversation.id === selectedConversationId)) {\n      setSelectedConversationId(visibleConversations[0]?.id);\n    }\n  }, [visibleConversations, selectedConversationId]);`;
  const newSelectionEffect = `  useEffect(() => {\n    if (!selectedConversationId) {\n      if (visibleConversations.length) setSelectedConversationId(visibleConversations[0]?.id);\n      return;\n    }\n    const stillExists = inbox?.conversations.some((conversation) => conversation.id === selectedConversationId);\n    if (!stillExists) setSelectedConversationId(visibleConversations[0]?.id);\n  }, [visibleConversations, selectedConversationId, inbox]);`;
  app = replaceOnce(app, oldSelectionEffect, newSelectionEffect, 'keep selected conversation visible after answering');

  app = app.replace(
    `              onSuggest={() => void suggestReply()}`,
    `              suggestBusy={aiReplyBusy}\n              onSuggest={() => void suggestReply()}`,
  );

  app = app.replace(
    `onSend, onSuggest, onOpenPublication`,
    `onSend, suggestBusy, onSuggest, onOpenPublication`,
  );
  app = app.replace(
    `  onSuggest: () => void;`,
    `  suggestBusy: boolean;\n  onSuggest: () => void;`,
  );

  app = app.replace(
    `{aiReady && <button onClick={onSuggest}><Sparkles size={15} /> Proposer une réponse</button>}`,
    `{aiReady && <div className="sc27-ai-reply-wrap"><button type="button" onClick={onSuggest} disabled={suggestBusy} className={suggestBusy ? 'busy' : ''}>{suggestBusy ? <LoaderCircle className="sc3-spin" size={15} /> : <Sparkles size={15} />} {suggestBusy ? 'Rédaction en cours…' : 'Proposer une réponse'}</button>{suggestBusy && <small>L’IA analyse le profil, le message et son contexte…</small>}</div>}`,
  );

  app = app.replace(
    `<span><strong>{selected.contactName}</strong><small>{selected.handle || selected.accountName}</small></span>`,
    `<span className="sc27-contact-identity"><strong>{selected.contactName}</strong><small>{selected.handle || platformLabel(selected.platform)} · {platformLabel(selected.platform)} · via {selected.accountName || 'Compte connecté'} · {selected.latestMessage?.type === 'comment' ? 'Commentaire public' : 'Message privé'}</small></span>`,
  );

  app = app.replace(
    `<button type="submit" disabled={!outboundReady || !reply.trim()}><Send size={17} /></button>`,
    `<button type="submit" disabled={!outboundReady || !reply.trim() || replyBusy} aria-label={replyBusy ? 'Envoi en cours' : 'Envoyer'}>{replyBusy ? <LoaderCircle className="sc3-spin" size={17} /> : <Send size={17} />}</button>`,
  );

  app += '\n/* SC_INBOX_REPLY_UX_V1 */\n';
  fs.writeFileSync(appPath, app);
}

// 4) Make the publication writing assistant genuinely free and usable for text-only creation AND editing.
const writerPath = 'src/worker/social-copy-writer.ts';
let writer = fs.readFileSync(writerPath, 'utf8');
if (!writer.includes('SC_WORKERS_AI_SOCIAL_COPY_V1')) {
  writer = replaceOnce(
    writer,
    `function boundedText(value: unknown, max: number): string {`,
    `type WorkersAiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };\n\nfunction workersAiBinding(env: Env): WorkersAiBinding | undefined {\n  const value = Reflect.get(env, 'AI');\n  if (!value || typeof value !== 'object' || typeof Reflect.get(value, 'run') !== 'function') return undefined;\n  return value as WorkersAiBinding;\n}\n\nfunction workersAiModel(env: Env): string {\n  const configured = Reflect.get(env, 'WORKERS_AI_MODEL');\n  return typeof configured === 'string' && configured.trim() ? configured.trim() : '@cf/meta/llama-3.1-8b-instruct-fast';\n}\n\nfunction workersAiText(payload: unknown): string {\n  if (typeof payload === 'string') return payload.trim();\n  if (!payload || typeof payload !== 'object') return '';\n  const candidate = payload as { response?: unknown; text?: unknown; result?: unknown };\n  if (typeof candidate.response === 'string') return candidate.response.trim();\n  if (typeof candidate.text === 'string') return candidate.text.trim();\n  if (candidate.result && typeof candidate.result === 'object') {\n    const nested = candidate.result as { response?: unknown; text?: unknown };\n    if (typeof nested.response === 'string') return nested.response.trim();\n    if (typeof nested.text === 'string') return nested.text.trim();\n  }\n  return '';\n}\n\nfunction cleanJsonText(value: string): string {\n  return value.trim().replace(/^\\s*\\`\\`\\`(?:json)?/i, '').replace(/\\`\\`\\`\\s*$/i, '').trim();\n}\n\nfunction boundedText(value: unknown, max: number): string {`,
    'Workers AI social copy helpers',
  );

  writer = writer.replace(
    `  instagram: new Set(['caption']),\n  youtube: new Set(['title', 'description', 'tags']),\n  tiktok: new Set(['title', 'description']),`,
    `  instagram: new Set(['caption']),\n  facebook: new Set(['message']),\n  linkedin: new Set(['commentary']),\n  youtube: new Set(['title', 'description', 'tags']),\n  tiktok: new Set(['title', 'description']),\n  threads: new Set(['text', 'caption']),`,
  );

  writer = replaceOnce(
    writer,
    `  const apiKey = optionalSecret(env, 'OPENAI_API_KEY');\n  if (!apiKey) throw new SocialCopyError('AI_NOT_READY', 'OpenAI API key is not configured.');\n  const request = normalizeRequest(input);`,
    `  const workersAi = workersAiBinding(env);\n  const apiKey = optionalSecret(env, 'OPENAI_API_KEY');\n  if (!workersAi && !apiKey) throw new SocialCopyError('AI_NOT_READY', 'Aucun moteur IA n’est disponible.');\n  const request = normalizeRequest(input);`,
    'free social copy readiness',
  );

  const providerStart = writer.indexOf('  const controller = new AbortController();');
  const parsedStart = writer.indexOf('  let parsed: { fields?: Record<string, unknown> };', providerStart);
  if (providerStart < 0 || parsedStart < 0) throw new Error('Inbox reply/AI writer patch failed: social copy provider block not found.');
  const providerBlock = `  let text = '';\n  let usedModel = '';\n\n  if (workersAi) {\n    usedModel = workersAiModel(env);\n    const expected = request.writable.reduce<Record<string, string>>((acc, field) => {\n      acc[field.key] = field.kind === 'tags' ? 'tableau de chaînes' : 'chaîne';\n      return acc;\n    }, {});\n    try {\n      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('workers_ai_timeout')), 18_000));\n      const payload = await Promise.race([\n        workersAi.run(usedModel, {\n          messages: [\n            { role: 'system', content: 'Tu es un rédacteur social media senior. Retourne UNIQUEMENT un JSON valide sans markdown sous la forme {"fields":{...}}. Respecte strictement les noms de champs demandés. N’invente aucun fait, prix, résultat ou promesse absent du contexte.' },\n            { role: 'user', content: `${'${context}'}\\nFormat JSON attendu: {"fields":${'${JSON.stringify(expected)}'}}` },\n          ],\n          max_tokens: 900,\n          temperature: 0.45,\n        }),\n        timeout,\n      ]);\n      text = workersAiText(payload);\n    } catch (error) {\n      console.warn(JSON.stringify({ event: 'social_copy_workers_ai_failed', reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown', platform: request.platform, format: request.format }));\n      throw new SocialCopyError('AI_PROVIDER_FAILED', 'L’assistant de rédaction est temporairement indisponible.');\n    }\n  } else {\n    usedModel = modelName(env);\n    const controller = new AbortController();\n    const timeout = setTimeout(() => controller.abort(), 18_000);\n    let response: Response;\n    try {\n      response = await fetchImpl('https://api.openai.com/v1/responses', {\n        method: 'POST',\n        headers: { authorization: \`Bearer ${'${apiKey}'}\`, 'content-type': 'application/json' },\n        body: JSON.stringify({\n          model: usedModel,\n          reasoning: { effort: 'low' },\n          instructions: 'Tu es un rédacteur social media senior. Tu aides à préparer un brouillon modifiable, jamais à publier automatiquement. Retourne uniquement la structure demandée.',\n          input: context,\n          text: { format: { type: 'json_schema', name: 'social_copy_fields', strict: true, schema } },\n        }),\n        signal: controller.signal,\n      });\n    } catch (error) {\n      const reason = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network';\n      console.warn(JSON.stringify({ event: 'social_copy_provider_failed', reason, platform: request.platform, format: request.format }));\n      throw new SocialCopyError('AI_PROVIDER_FAILED', 'AI provider is temporarily unavailable.');\n    } finally {\n      clearTimeout(timeout);\n    }\n    if (!response.ok) {\n      console.warn(JSON.stringify({ event: 'social_copy_provider_failed', status: response.status, platform: request.platform, format: request.format }));\n      throw new SocialCopyError('AI_PROVIDER_FAILED', 'AI provider rejected the request.');\n    }\n    let payload: unknown;\n    try { payload = await response.json(); } catch { throw new SocialCopyError('AI_PROVIDER_FAILED', 'AI provider returned an invalid response.'); }\n    text = outputText(payload);\n  }\n\n  if (!text) throw new SocialCopyError('AI_EMPTY_RESPONSE', 'L’assistant n’a pas retourné de texte exploitable.');\n\n`;
  writer = writer.slice(0, providerStart) + providerBlock + writer.slice(parsedStart);
  writer = writer.replace(`    parsed = JSON.parse(text) as { fields?: Record<string, unknown> };`, `    parsed = JSON.parse(cleanJsonText(text)) as { fields?: Record<string, unknown> };`);
  writer = writer.replace(`    model: modelName(env),`, `    model: usedModel,`);
  writer += '\n// SC_WORKERS_AI_SOCIAL_COPY_V1\n';
  fs.writeFileSync(writerPath, writer);
}

// The existing publication assistant already has a loader; make it available for text-only posts and edits too.
app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_UNIFIED_PUBLICATION_AI_UX_V1')) {
  app = app.replace(
    `const writerSupported = Boolean(writerDraft && writerDraft.platform !== 'facebook' && !(writerDraft.platform === 'instagram' && writerDraft.format === 'story'));`,
    `const writerSupported = Boolean(writerDraft && !(writerDraft.platform === 'instagram' && writerDraft.format === 'story'));`,
  );
  app = app.replace(
    `if (!writerDraft || !selectedMedia || writerBusy || !writerSupported) return;`,
    `if (!writerDraft || writerBusy || !writerSupported) return;`,
  );
  app = app.replace(
    `        mediaTitle: selectedMedia.title,\n        mediaCaption: selectedMedia.caption,`,
    `        mediaTitle: selectedMedia?.title,\n        mediaCaption: selectedMedia?.caption,`,
  );
  app = app.replaceAll(`'Générer et remplir les textes'`, `'Générer ou améliorer les textes'`);
  app += '\n/* SC_UNIFIED_PUBLICATION_AI_UX_V1 */\n';
  fs.writeFileSync(appPath, app);
}

// 5) Visual feedback for reply generation and profile identity.
const cssPath = 'src/inbox-reply-ai-ux.css';
if (!fs.existsSync(cssPath)) {
  fs.writeFileSync(cssPath, `
.sc27-ai-reply-wrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sc27-ai-reply-wrap>button{display:inline-flex;align-items:center;gap:6px}.sc27-ai-reply-wrap>button.busy{cursor:wait;opacity:.75}.sc27-ai-reply-wrap>small{font-size:8px;color:#777d94}.sc27-contact-identity{display:grid;gap:2px;min-width:0}.sc27-contact-identity>small{white-space:normal;line-height:1.35}.sc3-message.outbound{margin-left:auto;background:#f0ebff;border-color:#d7c7ff}.sc3-message.outbound small{color:#6750a4}.sc3-reply button:disabled{cursor:not-allowed;opacity:.62}
`);
}
const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./inbox-reply-ai-ux.css")) {
  main += `\nimport './inbox-reply-ai-ux.css';\n`;
  fs.writeFileSync(mainPath, main);
}

console.log('Inbox reply delivery, profile context, AI loading and unified publication AI writing applied.');
