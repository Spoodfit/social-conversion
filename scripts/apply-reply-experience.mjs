import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Reply experience patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Keep YouTube commenter profile information when the API provides it.
const typesPath = 'src/shared/types.ts';
let types = fs.readFileSync(typesPath, 'utf8');
if (!types.includes('contactAvatarUrl?: string;')) {
  types = replaceOnce(
    types,
    `  contactName: string;\n  text: string;`,
    `  contactName: string;\n  contactAvatarUrl?: string;\n  text: string;`,
    'social event avatar field',
  );
  fs.writeFileSync(typesPath, types);
}

const providerPath = 'src/worker/provider-inbox-sync.ts';
let provider = fs.readFileSync(providerPath, 'utf8');
if (!provider.includes('SC_YOUTUBE_COMMENT_IDENTITY_V1')) {
  provider = replaceOnce(
    provider,
    `        authorDisplayName?: unknown;\n        textOriginal?: unknown;`,
    `        authorDisplayName?: unknown;\n        authorProfileImageUrl?: unknown;\n        textOriginal?: unknown;`,
    'YouTube avatar response field',
  );
  provider = replaceOnce(
    provider,
    `    const authorName = stringValue(snippet?.authorDisplayName, 180);\n    const authorChannelId = stringValue(snippet?.authorChannelId?.value, 200);`,
    `    const authorName = stringValue(snippet?.authorDisplayName, 180);\n    const authorAvatarUrl = stringValue(snippet?.authorProfileImageUrl, 2_000);\n    const authorChannelId = stringValue(snippet?.authorChannelId?.value, 200);`,
    'YouTube avatar normalization',
  );
  provider = replaceOnce(
    provider,
    `      contactName: authorName || 'Utilisateur YouTube',\n      text,`,
    `      contactName: authorName || 'Utilisateur YouTube',\n      contactAvatarUrl: authorAvatarUrl.startsWith('https://') ? authorAvatarUrl : undefined,\n      text,`,
    'YouTube avatar event payload',
  );
  provider += '\n// SC_YOUTUBE_COMMENT_IDENTITY_V1\n';
  fs.writeFileSync(providerPath, provider);
}

const persistencePath = 'src/worker/persistence.ts';
let persistence = fs.readFileSync(persistencePath, 'utf8');
if (!persistence.includes('SC_GENERIC_CONTACT_AVATAR_V1')) {
  const oldContact = `    db\n      .prepare(\n        \`INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at\`,\n      )\n      .bind(\n        contactId,\n        event.workspaceId,\n        event.externalContactId,\n        event.platform,\n        event.contactName,\n        event.occurredAt,\n        event.occurredAt,\n      ),`;
  const newContact = `    db\n      .prepare(\n        \`INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, metadata_json, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET\n           display_name = excluded.display_name,\n           metadata_json = CASE WHEN excluded.metadata_json <> '{}' THEN excluded.metadata_json ELSE contacts.metadata_json END,\n           updated_at = excluded.updated_at\`,\n      )\n      .bind(\n        contactId,\n        event.workspaceId,\n        event.externalContactId,\n        event.platform,\n        event.contactName,\n        event.contactAvatarUrl ? JSON.stringify({ avatarUrl: event.contactAvatarUrl }) : '{}',\n        event.occurredAt,\n        event.occurredAt,\n      ),`;
  persistence = replaceOnce(persistence, oldContact, newContact, 'generic contact avatar persistence');
  persistence += '\n// SC_GENERIC_CONTACT_AVATAR_V1\n';
  fs.writeFileSync(persistencePath, persistence);
}

// 2) Intercept YouTube comment replies before the historical Instagram-only outbox.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('SC_YOUTUBE_COMMENT_REPLY_V1')) {
  const importAnchor = `import type { NormalizedSocialEvent } from '../shared/types';`;
  production = replaceOnce(
    production,
    importAnchor,
    `${importAnchor}\nimport { sendYouTubeCommentReply, YouTubeCommentReplyError } from './youtube-comment-outbound';`,
    'YouTube reply import',
  );

  const oauthAnchor = `function oauthErrorResponse(error: InstagramOAuthError): Response {`;
  const handler = `async function maybeHandleYouTubeCommentReply(request: Request, env: Env): Promise<Response | undefined> {\n  const body = await request.clone().json().catch(() => undefined) as { conversationId?: unknown; message?: unknown } | undefined;\n  if (!body || typeof body.conversationId !== 'string' || typeof body.message !== 'string') return undefined;\n\n  const auth = await authenticateMutation(request.clone(), env, '/api/messages/youtube');\n  if (!auth.ok) return auth.response;\n  const youtube = await env.DB.prepare(\n    \`SELECT 1 AS present\n     FROM conversations c\n     JOIN social_connections sc ON sc.id = c.connection_id AND sc.workspace_id = c.workspace_id\n     WHERE c.id = ? AND c.workspace_id = ? AND sc.platform = 'youtube'\`,\n  ).bind(body.conversationId, auth.principal.workspaceId).first<{ present: number }>();\n  if (!youtube) return undefined;\n\n  try {\n    const result = await sendYouTubeCommentReply(env.DB, env, auth.principal, body.conversationId, body.message);\n    await writeAuditLog(env.DB, auth.principal, 'youtube.comment_replied', 'conversation', body.conversationId, { provider: 'youtube' });\n    return Response.json(result, { status: 201 });\n  } catch (error) {\n    if (error instanceof YouTubeCommentReplyError) {\n      const status = error.code === 'CONVERSATION_NOT_FOUND' ? 404\n        : error.code === 'YOUTUBE_NOT_READY' || error.code === 'YOUTUBE_SCOPE_MISSING' ? 409\n          : error.code === 'NOT_YOUTUBE_COMMENT' ? 400\n            : 502;\n      return Response.json({ error: error.message, code: error.code }, { status });\n    }\n    throw error;\n  }\n}\n\n`;
  production = production.replace(oauthAnchor, handler + oauthAnchor);

  production = replaceOnce(
    production,
    `    if (url.pathname === '/api/messages' && request.method === 'POST') {\n      return handleOutboundApi(request, env);\n    }`,
    `    if (url.pathname === '/api/messages' && request.method === 'POST') {\n      const youtubeReply = await maybeHandleYouTubeCommentReply(request, env);\n      if (youtubeReply) return youtubeReply;\n      return handleOutboundApi(request, env);\n    }`,
    'YouTube reply route interception',
  );

  production = production.replace(
    `          outboundReady: isLive(env) && instagramOutboundConfigured(env),`,
    `          outboundReady: isLive(env) && (instagramOutboundConfigured(env) || socialOAuthConfigured(env, 'youtube')),`,
  );
  production += '\n// SC_YOUTUBE_COMMENT_REPLY_V1\n';
  fs.writeFileSync(productionPath, production);
}

// 3) Inbox: truthful send state, immediate local echo, stable selected thread and visible busy states.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_REPLY_EXPERIENCE_UI_V1')) {
  app = replaceOnce(
    app,
    `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);`,
    `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);\n  const [suggestBusy, setSuggestBusy] = useState(false);`,
    'suggest busy state',
  );

  const effectStart = app.indexOf(`  useEffect(() => {\n    if (!visibleConversations.length) {`);
  const effectEnd = effectStart >= 0 ? app.indexOf(`\n\n  const selectedConversation = useMemo(`, effectStart) : -1;
  if (effectStart >= 0 && effectEnd > effectStart) {
    const stableEffect = `  useEffect(() => {\n    const selectedStillExists = Boolean(selectedConversationId && inbox?.conversations.some((conversation) => conversation.id === selectedConversationId));\n    if (selectedStillExists) return;\n    if (visibleConversations.length) setSelectedConversationId(visibleConversations[0]?.id);\n    else setSelectedConversationId(undefined);\n  }, [visibleConversations, selectedConversationId, inbox]);`;
    app = app.slice(0, effectStart) + stableEffect + app.slice(effectEnd);
  }

  const sendStart = app.indexOf('  async function sendReply(event: FormEvent) {');
  const sendEnd = sendStart >= 0 ? app.indexOf('\n\n  async function suggestReply()', sendStart) : -1;
  if (sendStart < 0 || sendEnd < 0) throw new Error('Reply experience patch failed: sendReply block not found.');
  const sendReplacement = `  async function sendReply(event: FormEvent) {\n    event.preventDefault();\n    if (!workspaceId || !selectedConversation || !reply.trim() || replyBusy) return;\n    if (!runtime.outboundReady) {\n      setToast('L’envoi réel n’est pas disponible pour ce compte.');\n      return;\n    }\n    const outgoingText = reply.trim();\n    setReplyBusy(true);\n    try {\n      const result = await apiRequest<{ status: string; provider?: string; message?: ConversationMessage }>('/api/messages', {\n        method: 'POST',\n        body: JSON.stringify({\n          conversationId: selectedConversation.id,\n          message: outgoingText,\n          idempotencyKey: crypto.randomUUID(),\n        }),\n      }, workspaceId);\n\n      if (result.status === 'sent') {\n        if (result.message) {\n          setMessages((current) => current ? {\n            ...current,\n            messages: [result.message!, ...current.messages.filter((message) => message.id !== result.message!.id)],\n          } : { conversationId: selectedConversation.id, messages: [result.message!], page: { limit: 50, hasMore: false } });\n          setInbox((current) => current ? {\n            ...current,\n            conversations: current.conversations.map((conversation) => conversation.id === selectedConversation.id ? {\n              ...conversation,\n              unread: false,\n              needsReply: false,\n              lastMessageAt: result.message!.sentAt,\n              updatedAt: result.message!.createdAt,\n              latestMessage: {\n                body: result.message!.body,\n                direction: 'outbound',\n                type: result.message!.type,\n                sentAt: result.message!.sentAt,\n              },\n            } : conversation),\n          } : current);\n        }\n        setReply('');\n        setToast(result.provider === 'youtube' ? 'Réponse publiée sur YouTube.' : 'Réponse envoyée.');\n        window.setTimeout(() => { void refreshInbox(false); }, 1200);\n      } else {\n        setReply('');\n        setToast('Réponse prise en charge. Envoi en cours…');\n        window.setTimeout(() => { void refreshInbox(false); }, 1800);\n      }\n    } catch (error) {\n      setToast(readableError(error));\n    } finally {\n      setReplyBusy(false);\n    }\n  }`;
  app = app.slice(0, sendStart) + sendReplacement + app.slice(sendEnd);

  const suggestStart = app.indexOf('  async function suggestReply() {');
  const suggestEnd = suggestStart >= 0 ? app.indexOf('\n\n  function openCreate(', suggestStart) : -1;
  if (suggestStart < 0 || suggestEnd < 0) throw new Error('Reply experience patch failed: suggestReply block not found.');
  const suggestReplacement = `  async function suggestReply() {\n    if (!workspaceId || !selectedConversation || suggestBusy) return;\n    if (!runtime.aiReady) {\n      setToast('Le copilote IA n’est pas encore disponible.');\n      return;\n    }\n    setSuggestBusy(true);\n    try {\n      const result = await apiRequest<AiDraftPayload>('/api/ai/suggest', {\n        method: 'POST',\n        body: JSON.stringify({ conversationId: selectedConversation.id }),\n      }, workspaceId);\n      setReply(result.draft.body);\n    } catch (error) {\n      setToast(readableError(error));\n    } finally {\n      setSuggestBusy(false);\n    }\n  }`;
  app = app.slice(0, suggestStart) + suggestReplacement + app.slice(suggestEnd);

  app = app.replaceAll(
    `              reply={reply}\n              outboundReady=`,
    `              reply={reply}\n              replyBusy={replyBusy}\n              suggestBusy={suggestBusy}\n              outboundReady=`,
  );

  app = app.replace(
    `function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onSend, onSuggest, onOpenPublication }: {`,
    `function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, replyBusy, suggestBusy, outboundReady, aiReady, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onSend, onSuggest, onOpenPublication }: {`,
  );
  app = app.replace(
    `  reply: string;\n  outboundReady: boolean;\n  aiReady: boolean;`,
    `  reply: string;\n  replyBusy: boolean;\n  suggestBusy: boolean;\n  outboundReady: boolean;\n  aiReady: boolean;`,
  );

  app = app.replaceAll(
    `{aiReady && <button onClick={onSuggest}><Sparkles size={15} /> Proposer une réponse</button>}`,
    `{aiReady && <button onClick={onSuggest} disabled={suggestBusy}>{suggestBusy ? <LoaderCircle className="sc3-spin" size={15} /> : <Sparkles size={15} />} {suggestBusy ? 'Rédaction…' : 'Proposer une réponse'}</button>}`,
  );
  app = app.replaceAll(
    `<button type="submit" disabled={!outboundReady || !reply.trim()}><Send size={17} /></button>`,
    `<button type="submit" disabled={!outboundReady || !reply.trim() || replyBusy} aria-label={replyBusy ? 'Envoi en cours' : 'Envoyer'}>{replyBusy ? <LoaderCircle className="sc3-spin" size={17} /> : <Send size={17} />}</button>`,
  );

  app += '\n/* SC_REPLY_EXPERIENCE_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('Real YouTube comment replies, profile identity and reply busy UX applied.');
