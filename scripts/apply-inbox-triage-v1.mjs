import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Inbox triage v1 failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) D1 inbox read state + derived reply state.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_INBOX_TRIAGE_LIVE_DATA_V1')) {
  liveData = replaceOnce(
    liveData,
`  latest_message_context_json: string | null;
  latest_message_sent_at: string | null;`,
`  latest_message_context_json: string | null;
  latest_message_sent_at: string | null;
  last_read_at: string | null;`,
    'inbox row read state',
  );

  liveData = replaceOnce(
    liveData,
`    status?: string;
    stage?: string;
  } = {},`,
`    status?: string;
    stage?: string;
    memberId?: string;
  } = {},`,
    'inbox member query',
  );

  liveData = replaceOnce(
    liveData,
`  const bindings: unknown[] = [workspaceId];`,
`  const bindings: unknown[] = [query.memberId ?? '', workspaceId];`,
    'inbox read binding',
  );

  liveData = replaceOnce(
    liveData,
`       (SELECT m.context_json FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_context_json,
       (SELECT m.sent_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_sent_at
     FROM conversations c`,
`       (SELECT m.context_json FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_context_json,
       (SELECT m.sent_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_sent_at,
       (SELECT cr.last_read_at FROM conversation_reads cr
        WHERE cr.workspace_id = c.workspace_id AND cr.member_id = ? AND cr.conversation_id = c.id
        LIMIT 1) AS last_read_at
     FROM conversations c`,
    'inbox read select',
  );

  liveData = replaceOnce(
    liveData,
`      updatedAt: row.updated_at,
      latestMessage: row.latest_message_sent_at ? {`,
`      updatedAt: row.updated_at,
      unread: Boolean(
        row.latest_message_sent_at
        && row.latest_message_direction === 'inbound'
        && (!row.last_read_at || row.latest_message_sent_at > row.last_read_at)
      ),
      needsReply: row.latest_message_direction === 'inbound',
      latestMessage: row.latest_message_sent_at ? {`,
    'inbox triage response',
  );

  const insertAt = liveData.indexOf('export async function updateConversationCrm(');
  if (insertAt < 0) throw new Error('Inbox triage v1 failed: CRM function anchor not found.');
  const readFunction = `export async function markConversationRead(\n  db: D1Database,\n  principal: WorkspacePrincipal,\n  conversationId: string,\n) {\n  const exists = await db.prepare(\n    'SELECT 1 AS present FROM conversations WHERE id = ? AND workspace_id = ?',\n  ).bind(conversationId, principal.workspaceId).first<{ present: number }>();\n  if (!exists) throw new LiveDataError('CONVERSATION_NOT_FOUND', 'Conversation not found in this workspace.');\n  const lastReadAt = new Date().toISOString();\n  await db.prepare(\n    \`INSERT INTO conversation_reads (workspace_id, member_id, conversation_id, last_read_at)\n     VALUES (?, ?, ?, ?)\n     ON CONFLICT(workspace_id, member_id, conversation_id) DO UPDATE SET\n       last_read_at = excluded.last_read_at\`,\n  ).bind(principal.workspaceId, principal.memberId, conversationId, lastReadAt).run();\n  return { conversationId, lastReadAt };\n}\n\n`;
  liveData = liveData.slice(0, insertAt) + readFunction + liveData.slice(insertAt);
  liveData += '\n// SC_INBOX_TRIAGE_LIVE_DATA_V1\n';
  fs.writeFileSync(liveDataPath, liveData);
}

// 2) API: force a fresh Facebook catch-up when explicitly refreshing the Inbox,
// pass the member id for unread state, and persist read acknowledgements.
const workerPath = 'src/worker/index.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('SC_INBOX_TRIAGE_API_V1')) {
  worker = replaceOnce(
    worker,
`  listConversationMessages,
  listInboxConversations,
  updateConversationCrm,`,
`  listConversationMessages,
  listInboxConversations,
  markConversationRead,
  updateConversationCrm,`,
    'mark read import',
  );

  worker = replaceOnce(
    worker,
`      const facebookSync = await syncWorkspaceFacebookRuntime(c.env.DB, c.env, principal.workspaceId).catch((error) => {
        console.warn(JSON.stringify({ event: 'facebook_runtime_inbox_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));`,
`      const facebookSync = await syncWorkspaceFacebookRuntime(
        c.env.DB,
        c.env,
        principal.workspaceId,
        fetch,
        c.req.query('refresh') === '1',
      ).catch((error) => {
        console.warn(JSON.stringify({ event: 'facebook_runtime_inbox_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));`,
    'forced Facebook Inbox sync',
  );

  worker = replaceOnce(
    worker,
`        status: c.req.query('status'),
        stage: c.req.query('stage'),
      });`,
`        status: c.req.query('status'),
        stage: c.req.query('stage'),
        memberId: principal.memberId,
      });`,
    'member id in Inbox listing',
  );

  const messagesRoute = `  app.get('/api/inbox/conversations/:id/messages', async (c) => {`;
  const routeIndex = worker.indexOf(messagesRoute);
  if (routeIndex < 0) throw new Error('Inbox triage v1 failed: messages route anchor not found.');
  const readRoute = `  app.post('/api/inbox/conversations/:id/read', async (c) => {\n    if (!liveDataReady(c.env)) return c.json({ error: 'Live inbox is locked.', code: 'LIVE_NOT_READY' }, 503);\n    const principal = c.get('principal');\n    try {\n      return c.json(await markConversationRead(c.env.DB, principal, c.req.param('id')));\n    } catch (error) {\n      if (error instanceof LiveDataError && error.code === 'CONVERSATION_NOT_FOUND') {\n        return c.json({ error: error.message, code: error.code }, 404);\n      }\n      throw error;\n    }\n  });\n\n`;
  worker = worker.slice(0, routeIndex) + readRoute + worker.slice(routeIndex);
  worker += '\n// SC_INBOX_TRIAGE_API_V1\n';
  fs.writeFileSync(workerPath, worker);
}

// 3) UI: operational triage, per-member unread state, fresh sync on Inbox open and manual refresh.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_INBOX_TRIAGE_UI_V1')) {
  app = replaceOnce(
    app,
`type InboxFilter = 'all' | 'messages' | 'comments';`,
`type InboxFilter = 'all' | 'messages' | 'comments';
type InboxStatusFilter = 'todo' | 'unread' | 'answered' | 'all';`,
    'Inbox status type',
  );

  app = replaceOnce(
    app,
`  assignedTo?: string;
  updatedAt?: string;
  latestMessage?: {`,
`  assignedTo?: string;
  updatedAt?: string;
  unread: boolean;
  needsReply: boolean;
  latestMessage?: {`,
    'conversation triage fields',
  );

  app = replaceOnce(
    app,
`type InboxPayload = {
  conversations: LiveConversation[];
  page: { limit: number; hasMore: boolean; nextCursor?: string };
};`,
`type InboxPayload = {
  conversations: LiveConversation[];
  page: { limit: number; hasMore: boolean; nextCursor?: string };
  facebookSync?: {
    synced: number;
    skipped: number;
    failed: number;
    posts: number;
    comments: number;
    messages: number;
    issues?: Array<{ connectionId: string; displayName: string; errors: string[] }>;
  };
};`,
    'Inbox sync diagnostics type',
  );

  app = replaceOnce(
    app,
`  const [query, setQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [selectedConversationId, setSelectedConversationId] = useState<string>();`,
`  const [query, setQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [inboxStatusFilter, setInboxStatusFilter] = useState<InboxStatusFilter>('todo');
  const [inboxRefreshBusy, setInboxRefreshBusy] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string>();`,
    'Inbox triage state',
  );

  const oldVisible = `  const visibleConversations = useMemo(() => {\n    if (!inbox) return [];\n    const connectionId = activeConnection?.id;\n    return inbox.conversations.filter((conversation) => {\n      if (connectionId && conversation.connectionId !== connectionId) return false;\n      const haystack = \`\${conversation.contactName} \${conversation.handle ?? ''} \${conversation.latestMessage?.body ?? ''}\`.toLowerCase();\n      if (!haystack.includes(query.trim().toLowerCase())) return false;\n      const type = conversation.latestMessage?.type ?? 'message';\n      if (inboxFilter === 'comments') return type === 'comment';\n      if (inboxFilter === 'messages') return type !== 'comment';\n      return true;\n    });\n  }, [inbox, activeConnection, query, inboxFilter]);`;
  const newVisible = `  const visibleConversations = useMemo(() => {\n    if (!inbox) return [];\n    const connectionId = activeConnection?.id;\n    return inbox.conversations.filter((conversation) => {\n      if (connectionId && conversation.connectionId !== connectionId) return false;\n      const haystack = \`\${conversation.contactName} \${conversation.handle ?? ''} \${conversation.latestMessage?.body ?? ''}\`.toLowerCase();\n      if (!haystack.includes(query.trim().toLowerCase())) return false;\n      const type = conversation.latestMessage?.type ?? 'message';\n      if (inboxFilter === 'comments' && type !== 'comment') return false;\n      if (inboxFilter === 'messages' && type === 'comment') return false;\n      if (inboxStatusFilter === 'todo' && !conversation.needsReply) return false;\n      if (inboxStatusFilter === 'unread' && !conversation.unread) return false;\n      if (inboxStatusFilter === 'answered' && conversation.needsReply) return false;\n      return true;\n    }).sort((a, b) => {\n      const rank = (conversation: LiveConversation) => conversation.unread ? 0 : conversation.needsReply ? 1 : 2;\n      const rankDelta = rank(a) - rank(b);\n      if (rankDelta) return rankDelta;\n      return Date.parse(b.latestMessage?.sentAt ?? b.updatedAt ?? '') - Date.parse(a.latestMessage?.sentAt ?? a.updatedAt ?? '');\n    });\n  }, [inbox, activeConnection, query, inboxFilter, inboxStatusFilter]);`;
  app = replaceOnce(app, oldVisible, newVisible, 'visible Inbox triage');

  const navigateAnchor = `  function navigate(next: Page) {\n    setPage(next);\n    window.scrollTo({ top: 0, behavior: 'smooth' });\n  }`;
  const navigateReplacement = `${navigateAnchor}\n\n  async function refreshInbox(force = false) {\n    if (!workspaceId) return;\n    if (force) setInboxRefreshBusy(true);\n    try {\n      const payload = await apiRequest<InboxPayload>(\`/api/inbox/conversations?limit=50\${force ? '&refresh=1' : ''}\`, {}, workspaceId);\n      setInbox(payload);\n    } catch (error) {\n      setToast(readableError(error));\n    } finally {\n      if (force) setInboxRefreshBusy(false);\n    }\n  }`;
  app = replaceOnce(app, navigateAnchor, navigateReplacement, 'Inbox refresh function');

  const messageEffectAnchor = `  useEffect(() => {\n    if (!workspaceId || !selectedConversationId) {\n      setMessages(undefined);\n      return undefined;\n    }\n    let active = true;\n    setMessagesBusy(true);\n    apiRequest<MessagesPayload>(\`/api/inbox/conversations/\${encodeURIComponent(selectedConversationId)}/messages?limit=50\`, {}, workspaceId)\n      .then((payload) => active && setMessages(payload))\n      .catch((error) => active && setToast(readableError(error)))\n      .finally(() => active && setMessagesBusy(false));\n    return () => { active = false; };\n  }, [workspaceId, selectedConversationId]);`;
  const messageEffectReplacement = `${messageEffectAnchor}\n\n  useEffect(() => {\n    if (!workspaceId || page !== 'inbox') return undefined;\n    let active = true;\n    void refreshInbox(true);\n    const timer = window.setInterval(() => { if (active) void refreshInbox(false); }, 30_000);\n    return () => { active = false; window.clearInterval(timer); };\n  }, [workspaceId, page]);\n\n  useEffect(() => {\n    if (!workspaceId || page !== 'inbox' || !selectedConversationId) return;\n    const conversation = inbox?.conversations.find((candidate) => candidate.id === selectedConversationId);\n    if (!conversation?.unread) return;\n    void apiRequest(\`/api/inbox/conversations/\${encodeURIComponent(selectedConversationId)}/read\`, { method: 'POST' }, workspaceId)\n      .then(() => setInbox((current) => current ? {\n        ...current,\n        conversations: current.conversations.map((candidate) => candidate.id === selectedConversationId ? { ...candidate, unread: false } : candidate),\n      } : current))\n      .catch((error) => setToast(readableError(error)));\n  }, [workspaceId, page, selectedConversationId, inbox]);`;
  app = replaceOnce(app, messageEffectAnchor, messageEffectReplacement, 'Inbox refresh/read effects');

  app = replaceOnce(
    app,
`              query={query}
              filter={inboxFilter}
              reply={reply}`, 
`              query={query}
              filter={inboxFilter}
              statusFilter={inboxStatusFilter}
              refreshBusy={inboxRefreshBusy}
              sync={inbox?.facebookSync}
              reply={reply}`,
    'Inbox triage props',
  );

  app = replaceOnce(
    app,
`              onQuery={setQuery}
              onFilter={setInboxFilter}
              onSelect={setSelectedConversationId}`, 
`              onQuery={setQuery}
              onFilter={setInboxFilter}
              onStatusFilter={setInboxStatusFilter}
              onRefresh={() => void refreshInbox(true)}
              onSelect={setSelectedConversationId}`,
    'Inbox triage callbacks',
  );

  app = replaceOnce(
    app,
`function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest, onOpenPublication }: {`,
`function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onSend, onSuggest, onOpenPublication }: {`,
    'Inbox component signature',
  );

  app = replaceOnce(
    app,
`  query: string;
  filter: InboxFilter;
  reply: string;`,
`  query: string;
  filter: InboxFilter;
  statusFilter: InboxStatusFilter;
  refreshBusy: boolean;
  sync?: InboxPayload['facebookSync'];
  reply: string;`,
    'Inbox component triage props',
  );

  app = replaceOnce(
    app,
`  onQuery: (value: string) => void;
  onFilter: (value: InboxFilter) => void;
  onSelect: (id: string) => void;`,
`  onQuery: (value: string) => void;
  onFilter: (value: InboxFilter) => void;
  onStatusFilter: (value: InboxStatusFilter) => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;`,
    'Inbox component triage callbacks',
  );

  app = replaceOnce(
    app,
`      <div className="sc3-page-head compact"><div><h1>Inbox</h1><p>{accountLabel} · messages et commentaires au même endroit</p></div></div>`,
`      <div className="sc3-page-head compact"><div><h1>Inbox</h1><p>{accountLabel} · messages et commentaires au même endroit</p></div><div className="sc22-inbox-head-actions"><button type="button" className="sc22-refresh" onClick={onRefresh} disabled={refreshBusy} aria-label="Actualiser l’Inbox"><RefreshCw size={15} className={refreshBusy ? 'sc3-spin' : ''} /></button></div></div>`,
    'Inbox refresh button',
  );

  app = replaceOnce(
    app,
`          <label className="sc3-search"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Rechercher une personne…" /></label>
          <div className="sc3-filters">`,
`          <label className="sc3-search"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Rechercher une personne…" /></label>
          {sync && sync.failed > 0 && <div className="sc22-sync-warning">Facebook n’a pas pu synchroniser toutes les interactions. {sync.issues?.[0]?.errors?.[0] || 'Utilisez Actualiser ; si le problème persiste, reconnectez la Page.'}</div>}
          <div className="sc22-triage-tabs">
            {([['todo', 'À traiter'], ['unread', 'Non lus'], ['answered', 'Répondus'], ['all', 'Tous']] as Array<[InboxStatusFilter, string]>).map(([id, label]) => <button key={id} className={statusFilter === id ? 'active' : ''} onClick={() => onStatusFilter(id)}>{label}</button>)}
          </div>
          <div className="sc3-filters">`,
    'Inbox triage tabs',
  );

  app = replaceOnce(
    app,
`              <button key={conversation.id} className={selected?.id === conversation.id ? 'active' : ''} onClick={() => onSelect(conversation.id)}>`,
`              <button key={conversation.id} className={\`sc22-row \${conversation.unread ? 'unread' : ''} \${selected?.id === conversation.id ? 'active' : ''}\`} onClick={() => onSelect(conversation.id)}>`,
    'Inbox row unread class',
  );

  app = replaceOnce(
    app,
`<em><PlatformMark platform={conversation.platform} size={12} /> {conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}</em>{conversation.latestMessage?.type === 'comment'`,
`<em><PlatformMark platform={conversation.platform} size={12} /> {conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}</em><i className={\`sc22-row-state \${conversation.unread ? 'unread' : conversation.needsReply ? 'todo' : 'answered'}\`}>{conversation.unread ? 'Non lu' : conversation.needsReply ? 'À répondre' : 'Répondu'}</i>{conversation.latestMessage?.type === 'comment'`,
    'Inbox row state badge',
  );

  app = replaceOnce(
    app,
`<header><div><span className="sc3-avatar">{selected.contactName.slice(0, 2).toUpperCase()}</span><span><strong>{selected.contactName}</strong><small>{selected.handle || selected.accountName}</small></span></div><b>{selected.leadStage}</b></header>`,
`<header><div><span className="sc3-avatar">{selected.contactName.slice(0, 2).toUpperCase()}</span><span><strong>{selected.contactName}</strong><small>{selected.handle || selected.accountName}</small></span></div><div className="sc22-inbox-head-actions"><span className={\`sc22-thread-state \${selected.unread ? 'unread' : selected.needsReply ? 'todo' : 'answered'}\`}>{selected.unread ? 'Non lu' : selected.needsReply ? 'À répondre' : 'Répondu'}</span><b>{selected.leadStage}</b></div></header>`,
    'Inbox thread state',
  );

  app += '\n/* SC_INBOX_TRIAGE_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./inbox-triage.css")) {
  main += "\nimport './inbox-triage.css';\n";
  fs.writeFileSync(mainPath, main);
}

console.log('Inbox triage v1: unread, to-do, answered and forced refresh applied.');
