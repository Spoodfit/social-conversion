import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Inbox reactions patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Worker route: expose provider-backed reaction state/mutations through the authenticated cockpit.
const cockpitPath = 'src/worker/cockpit-production.ts';
let cockpit = fs.readFileSync(cockpitPath, 'utf8');
if (!cockpit.includes('SC_INBOX_REACTIONS_COCKPIT_V1')) {
  cockpit = replaceOnce(
    cockpit,
    `} from './media-library';`,
    `} from './media-library';\nimport { InboxReactionError, listInboxReactionState, toggleInboxReaction } from './inbox-reactions';`,
    'reaction service import',
  );

  const workerAnchor = `const cockpitProductionWorker = {`;
  if (!cockpit.includes(workerAnchor)) throw new Error('Inbox reactions patch failed: cockpit worker anchor not found.');
  const reactionHandler = `function inboxReactionErrorResponse(error: InboxReactionError): Response {\n  if (error.code === 'REACTION_TARGET_NOT_FOUND') return Response.json({ error: error.message, code: error.code }, { status: 404 });\n  if (error.code === 'REACTION_SCOPE_MISSING' || error.code === 'REACTION_NOT_SUPPORTED') return Response.json({ error: error.message, code: error.code }, { status: 409 });\n  if (error.code === 'REACTION_PROVIDER_FAILED') return Response.json({ error: error.message, code: error.code }, { status: 502 });\n  if (error.code === 'REACTION_CONFIGURATION_MISSING') return Response.json({ error: error.message, code: error.code }, { status: 503 });\n  return Response.json({ error: error.message, code: error.code }, { status: 400 });\n}\n\nasync function handleInboxReactionApi(request: Request, env: Env, url: URL): Promise<Response> {\n  const auth = await authenticateWorkspace(request, env);\n  if (!auth.ok) return auth.response;\n  if (!isLive(env)) return Response.json({ error: 'Les réactions Inbox sont indisponibles hors mode live.', code: 'LIVE_NOT_READY' }, { status: 503 });\n\n  try {\n    if (request.method === 'GET') {\n      const conversationId = url.searchParams.get('conversationId')?.trim() ?? '';\n      if (!conversationId || conversationId.length > 500) return Response.json({ error: 'conversationId is required.', code: 'INVALID_REQUEST' }, { status: 400 });\n      const state = await listInboxReactionState(env.DB, auth.principal.workspaceId, conversationId);\n      if (!roleCanMutate(auth.principal.role)) return Response.json({ ...state, supported: false, reactionTypes: [] });\n      return Response.json(state);\n    }\n\n    if (request.method === 'POST') {\n      if (!roleCanMutate(auth.principal.role)) return Response.json({ error: 'Mutation forbidden for this role.', code: 'ROLE_FORBIDDEN' }, { status: 403 });\n      const body = await request.json().catch(() => undefined) as { conversationId?: unknown; messageId?: unknown; reactionType?: unknown } | undefined;\n      if (!body || typeof body.conversationId !== 'string' || typeof body.messageId !== 'string' || typeof body.reactionType !== 'string') {\n        return Response.json({ error: 'conversationId, messageId and reactionType are required.', code: 'INVALID_REQUEST' }, { status: 400 });\n      }\n      const result = await toggleInboxReaction(\n        env.DB,\n        env,\n        auth.principal.workspaceId,\n        body.conversationId,\n        body.messageId,\n        body.reactionType,\n      );\n      await writeAuditLog(env.DB, auth.principal, 'inbox.reaction_changed', 'message', body.messageId, {\n        conversationId: body.conversationId,\n        platform: result.platform,\n        reactionType: result.reactionType,\n      });\n      return Response.json(result);\n    }\n  } catch (error) {\n    if (error instanceof InboxReactionError) return inboxReactionErrorResponse(error);\n    throw error;\n  }\n\n  return Response.json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, { status: 405 });\n}\n\n`;
  cockpit = cockpit.replace(workerAnchor, reactionHandler + workerAnchor);
  cockpit = replaceOnce(
    cockpit,
    `    const url = new URL(request.url);\n    if (url.pathname === '/api/publications' || url.pathname.startsWith('/api/publications/')) {`,
    `    const url = new URL(request.url);\n    if (url.pathname === '/api/inbox/reactions') {\n      return handleInboxReactionApi(request, env, url);\n    }\n    if (url.pathname === '/api/publications' || url.pathname.startsWith('/api/publications/')) {`,
    'reaction route',
  );
  cockpit += '\n// SC_INBOX_REACTIONS_COCKPIT_V1\n';
  fs.writeFileSync(cockpitPath, cockpit);
}

// UI: render reactions only when the selected provider/permission combination actually supports them.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_INBOX_REACTIONS_UI_V1')) {
  if (!app.includes('  ThumbsUp,')) {
    app = replaceOnce(app, `  Trash2,\n  Upload,`, `  ThumbsUp,\n  Trash2,\n  Upload,`, 'ThumbsUp icon import');
  }

  app = replaceOnce(
    app,
    `            <InboxPage\n              conversations={visibleConversations}`,
    `            <InboxPage\n              workspaceId={workspaceId}\n              conversations={visibleConversations}`,
    'workspace passed to Inbox',
  );
  app = replaceOnce(
    app,
    `function InboxPage({ conversations,`,
    `function InboxPage({ workspaceId, conversations,`,
    'Inbox component workspace destructuring',
  );
  app = replaceOnce(
    app,
    `}: {\n  conversations: LiveConversation[];`,
    `}: {\n  workspaceId?: string;\n  conversations: LiveConversation[];`,
    'Inbox workspace prop type',
  );

  const stateAnchor = `  const replyTarget = messages?.messages.find((message) => message.id === replyTargetMessageId);`;
  const stateBlock = `  const [reactionState, setReactionState] = useState<Record<string, string>>({});\n  const [reactionTypes, setReactionTypes] = useState<string[]>([]);\n  const [reactionBusyMessageId, setReactionBusyMessageId] = useState<string>();\n  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string>();\n  const [reactionError, setReactionError] = useState<{ messageId: string; text: string }>();\n  const linkedinReactionOptions = [\n    { id: 'LIKE', emoji: '👍', label: 'J’aime' },\n    { id: 'PRAISE', emoji: '👏', label: 'Bravo' },\n    { id: 'EMPATHY', emoji: '❤️', label: 'J’adore' },\n    { id: 'INTEREST', emoji: '💡', label: 'Pertinent' },\n    { id: 'APPRECIATION', emoji: '🤝', label: 'Soutien' },\n    { id: 'ENTERTAINMENT', emoji: '😂', label: 'Drôle' },\n  ];\n  const reactionOption = (type?: string) => linkedinReactionOptions.find((option) => option.id === type);\n\n  useEffect(() => {\n    let active = true;\n    setReactionState({});\n    setReactionTypes([]);\n    setReactionPickerMessageId(undefined);\n    setReactionError(undefined);\n    if (!workspaceId || !selected || (selected.platform !== 'facebook' && selected.platform !== 'linkedin')) return () => { active = false; };\n    apiRequest<{ supported: boolean; reactionTypes: string[]; reactions: Record<string, string> }>(\n      \`/api/inbox/reactions?conversationId=\${encodeURIComponent(selected.id)}\`,\n      {},\n      workspaceId,\n    ).then((payload) => {\n      if (!active || !payload.supported) return;\n      setReactionTypes(payload.reactionTypes);\n      setReactionState(payload.reactions);\n    }).catch(() => {\n      if (!active) return;\n      setReactionTypes([]);\n      setReactionState({});\n    });\n    return () => { active = false; };\n  }, [workspaceId, selected?.id, selected?.platform]);\n\n  async function reactToInboxMessage(messageId: string, reactionType: string) {\n    if (!workspaceId || !selected || reactionBusyMessageId) return;\n    setReactionBusyMessageId(messageId);\n    setReactionError(undefined);\n    try {\n      const result = await apiRequest<{ messageId: string; reactionType: string | null }>('/api/inbox/reactions', {\n        method: 'POST',\n        body: JSON.stringify({ conversationId: selected.id, messageId, reactionType }),\n      }, workspaceId);\n      setReactionState((current) => {\n        const next = { ...current };\n        if (result.reactionType) next[messageId] = result.reactionType;\n        else delete next[messageId];\n        return next;\n      });\n      setReactionPickerMessageId(undefined);\n    } catch (error) {\n      setReactionError({ messageId, text: error instanceof Error ? error.message : 'La réaction n’a pas pu être envoyée.' });\n    } finally {\n      setReactionBusyMessageId(undefined);\n    }\n  }\n\n${stateAnchor}`;
  app = replaceOnce(app, stateAnchor, stateBlock, 'reaction state and provider action');

  const threadReply = `{selected.platform === 'threads' && message.direction === 'inbound' && message.type === 'comment' && <button type="button" className={\`sc26-inline-reply\${replyTargetMessageId === message.id ? ' active' : ''}\`} onClick={() => onReplyTarget(message.id)}><MessageCircle size={11} /> {replyTargetMessageId === message.id ? 'Réponse sélectionnée' : 'Répondre à ce message'}</button>}`;
  if (!app.includes(threadReply)) throw new Error('Inbox reactions patch failed: generated message action anchor not found.');
  const reactionActions = `${threadReply}{message.direction === 'inbound' && message.type === 'comment' && reactionTypes.length > 0 && (\n                        <div className="sc28-reaction-actions">\n                          {selected.platform === 'facebook' && reactionTypes.includes('LIKE') && (\n                            <button type="button" className={\`sc28-like-button\${reactionState[message.id] === 'LIKE' ? ' active' : ''}\`} disabled={reactionBusyMessageId === message.id} onClick={() => void reactToInboxMessage(message.id, 'LIKE')}><ThumbsUp size={12} /> {reactionBusyMessageId === message.id ? 'Envoi…' : reactionState[message.id] === 'LIKE' ? 'Aimé' : 'J’aime'}</button>\n                          )}\n                          {selected.platform === 'linkedin' && (\n                            <div className="sc28-linkedin-reaction">\n                              <button type="button" className={\`sc28-react-button\${reactionState[message.id] ? ' active' : ''}\`} disabled={reactionBusyMessageId === message.id} onClick={() => setReactionPickerMessageId((current) => current === message.id ? undefined : message.id)}>\n                                <span>{reactionOption(reactionState[message.id])?.emoji ?? '👍'}</span>\n                                {reactionBusyMessageId === message.id ? 'Envoi…' : reactionOption(reactionState[message.id])?.label ?? 'Réagir'}\n                              </button>\n                              {reactionPickerMessageId === message.id && (\n                                <div className="sc28-reaction-picker">\n                                  {linkedinReactionOptions.filter((option) => reactionTypes.includes(option.id)).map((option) => (\n                                    <button key={option.id} type="button" title={option.label} aria-label={option.label} className={reactionState[message.id] === option.id ? 'active' : ''} disabled={reactionBusyMessageId === message.id} onClick={() => void reactToInboxMessage(message.id, option.id)}><span>{option.emoji}</span><small>{option.label}</small></button>\n                                  ))}\n                                </div>\n                              )}\n                            </div>\n                          )}\n                          {reactionError?.messageId === message.id && <small className="sc28-reaction-error">{reactionError.text}</small>}\n                        </div>\n                      )}`;
  app = app.replace(threadReply, reactionActions);

  if (!app.includes('workspaceId={workspaceId}')) throw new Error('Inbox reactions patch failed: workspace prop missing.');
  if (!app.includes('reactToInboxMessage')) throw new Error('Inbox reactions patch failed: UI action missing.');
  if (!app.includes("selected.platform === 'facebook'")) throw new Error('Inbox reactions patch failed: Facebook control missing.');
  if (!app.includes("selected.platform === 'linkedin'")) throw new Error('Inbox reactions patch failed: LinkedIn control missing.');

  app += '\n/* SC_INBOX_REACTIONS_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

const cssPath = 'src/inbox-reactions.css';
if (!fs.existsSync(cssPath)) {
  fs.writeFileSync(cssPath, `.sc28-reaction-actions{position:relative;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px}.sc28-like-button,.sc28-react-button{min-height:27px;border:1px solid #e3e4ec;border-radius:999px;background:#fff;padding:0 9px;display:inline-flex;align-items:center;gap:5px;color:#656a80;font-size:8px;font-weight:800;cursor:pointer}.sc28-like-button:hover,.sc28-react-button:hover{border-color:#cfc5f5;background:#faf8ff;color:#5e33ca}.sc28-like-button.active,.sc28-react-button.active{border-color:#c9b9ff;background:#f0eaff;color:#6230d4}.sc28-like-button:disabled,.sc28-react-button:disabled{opacity:.55;cursor:wait}.sc28-linkedin-reaction{position:relative}.sc28-react-button>span{font-size:12px;line-height:1}.sc28-reaction-picker{position:absolute;left:0;bottom:calc(100% + 7px);z-index:20;display:flex;gap:3px;padding:5px;border:1px solid #dddfea;border-radius:13px;background:#fff;box-shadow:0 12px 30px rgba(20,22,58,.14)}.sc28-reaction-picker>button{width:42px;min-height:45px;border:0;border-radius:9px;background:transparent;display:grid;place-items:center;gap:1px;cursor:pointer}.sc28-reaction-picker>button:hover,.sc28-reaction-picker>button.active{background:#f2edff}.sc28-reaction-picker>button>span{font-size:18px;line-height:1}.sc28-reaction-picker>button>small{font-size:6px!important;color:#73788c!important;white-space:nowrap}.sc28-reaction-error{flex-basis:100%;color:#ad3838!important;font-size:7px!important;line-height:1.35}.sc3-message{overflow:visible!important}@media(max-width:760px){.sc28-reaction-picker{max-width:min(280px,calc(100vw - 48px));overflow-x:auto}.sc28-reaction-picker>button{flex:0 0 40px}}\n`);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./inbox-reactions.css")) {
  main += `\nimport './inbox-reactions.css';\n`;
  fs.writeFileSync(mainPath, main);
}

console.log('Capability-driven Facebook/LinkedIn Inbox reactions applied.');
