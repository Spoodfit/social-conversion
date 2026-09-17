import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Inbox as InboxIcon,
  Link2,
  LoaderCircle,
  MessageCircle,
  Music2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Video,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { ApiError, apiRequest } from './api/client';

export interface LiveRuntimeState {
  mode: 'live';
  ready: boolean;
  outboundReady: boolean;
  aiReady: boolean;
  publishingSchedulerReady?: boolean;
  contentPublishingReady?: boolean;
}

type WorkspaceRole = 'admin' | 'manager' | 'agent' | 'viewer';
type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';
type Page = 'inbox' | 'publish' | 'calendar' | 'results' | 'more';
type InboxFilter = 'all' | 'messages' | 'comments';
type PublishTiming = 'now' | 'later';

interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  status: 'invited' | 'active';
}

interface SessionPayload {
  subject: string;
  email?: string;
  workspace: {
    id: string;
    name: string;
    role: WorkspaceRole;
  };
}

interface LiveConnection {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  handle?: string;
  status: string;
  lastSyncedAt?: string;
}

interface LiveConversation {
  id: string;
  contactName: string;
  handle?: string;
  platform: SocialPlatform;
  accountName?: string;
  status: string;
  priority: string;
  leadStage: string;
  estimatedValueCents: number;
  lastMessageAt?: string;
  intent?: string;
  sentiment?: string;
  assignedTo?: string;
  updatedAt?: string;
  latestMessage?: {
    body: string;
    direction: 'inbound' | 'outbound' | null;
    type: string;
    sentAt: string;
  };
}

interface LiveBootstrap {
  workspace: { id: string; name: string; role: WorkspaceRole };
  metrics: {
    contacts: number;
    openConversations: number;
    connectedAccounts: number;
    estimatedPipelineCents: number;
  };
  connections: LiveConnection[];
  recentConversations: LiveConversation[];
}

interface PageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
}

interface InboxPayload {
  conversations: LiveConversation[];
  page: PageInfo;
}

interface ConversationMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  body: string;
  status: string;
  aiAssisted: boolean;
  sentAt: string;
  createdAt: string;
}

interface MessagesPayload {
  conversationId: string;
  messages: ConversationMessage[];
  page: PageInfo;
}

interface AiDraftPayload {
  draft: {
    id: string;
    body: string;
  };
}

interface PublicationTarget {
  id: string;
  connectionId: string;
  platform: SocialPlatform;
  status: string;
  displayName: string;
  handle?: string;
}

interface Publication {
  id: string;
  body: string;
  mediaReference?: string;
  status: string;
  scheduledAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  targets: PublicationTarget[];
}

interface PublicationsPayload {
  publications: Publication[];
}

const mainNav: Array<{ id: Exclude<Page, 'more'>; label: string; icon: LucideIcon }> = [
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'publish', label: 'Publier', icon: Plus },
  { id: 'calendar', label: 'Calendrier', icon: CalendarDays },
  { id: 'results', label: 'Résultats', icon: BarChart3 },
];

function platformLabel(platform: SocialPlatform) {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  return 'TikTok';
}

function platformIcon(platform: SocialPlatform, size = 17) {
  if (platform === 'instagram') return <Camera size={size} />;
  if (platform === 'youtube') return <Video size={size} />;
  return <Music2 size={size} />;
}

function PlatformMark({ platform }: { platform: SocialPlatform }) {
  return <span className={`platform-mark platform-${platform}`}>{platformIcon(platform)}</span>;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tomorrowKey() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDateKey(date);
}

function shortDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'WORKSPACE_FORBIDDEN') return 'Vous n’avez pas accès à cet espace.';
    if (error.code === 'LIVE_NOT_READY') return 'L’environnement live est encore verrouillé.';
    if (error.code === 'OUTBOUND_NOT_READY') return 'L’envoi vers ce réseau n’est pas encore prêt.';
    if (error.code === 'AI_NOT_READY') return 'Le copilote IA n’est pas configuré.';
    if (error.code === 'CONNECTION_NOT_READY') return error.message;
    return error.message;
  }
  return 'Une erreur inattendue empêche cette action.';
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="toast" role="status">
      <span className="toast-check"><Check size={15} /></span>
      <span>{text}</span>
      <button onClick={onClose} aria-label="Fermer"><X size={15} /></button>
    </div>
  );
}

export default function LiveApp({ runtime }: { runtime: LiveRuntimeState }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [session, setSession] = useState<SessionPayload>();
  const [bootstrap, setBootstrap] = useState<LiveBootstrap>();
  const [inbox, setInbox] = useState<InboxPayload>();
  const [page, setPage] = useState<Page>('inbox');
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [dataError, setDataError] = useState<string>();
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [selectedConversationId, setSelectedConversationId] = useState<string>();
  const [messages, setMessages] = useState<MessagesPayload>();
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string>();
  const [query, setQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [reply, setReply] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [toast, setToast] = useState('');

  const [publications, setPublications] = useState<Publication[]>([]);
  const [publicationsLoading, setPublicationsLoading] = useState(false);
  const [publicationsError, setPublicationsError] = useState<string>();
  const [publishBody, setPublishBody] = useState('');
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [timing, setTiming] = useState<PublishTiming>('later');
  const [scheduleDate, setScheduleDate] = useState(tomorrowKey());
  const [scheduleTime, setScheduleTime] = useState('10:00');
  const [publishBusy, setPublishBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setWorkspaceError(undefined);
    apiRequest<{ workspaces: WorkspaceSummary[] }>('/api/workspaces')
      .then(({ workspaces: available }) => {
        if (!active) return;
        setWorkspaces(available);
        const persisted = window.localStorage.getItem('social-conversion.workspace');
        const persistedWorkspace = available.find((workspace) => workspace.id === persisted);
        if (persistedWorkspace) setWorkspaceId(persistedWorkspace.id);
        else if (available.length === 1) setWorkspaceId(available[0]?.id);
      })
      .catch((error) => active && setWorkspaceError(readableError(error)));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let active = true;
    setSession(undefined);
    setBootstrap(undefined);
    setInbox(undefined);
    setDataError(undefined);
    setSelectedConversationId(undefined);
    setMessages(undefined);
    window.localStorage.setItem('social-conversion.workspace', workspaceId);

    Promise.all([
      apiRequest<SessionPayload>('/api/session', {}, workspaceId),
      apiRequest<LiveBootstrap>('/api/bootstrap', {}, workspaceId),
      apiRequest<InboxPayload>('/api/inbox/conversations?limit=50', {}, workspaceId),
    ])
      .then(([nextSession, nextBootstrap, nextInbox]) => {
        if (!active) return;
        setSession(nextSession);
        setBootstrap(nextBootstrap);
        setInbox(nextInbox);
        setSelectedConversationId(nextInbox.conversations[0]?.id);
        const connected = nextBootstrap.connections.filter((connection) => connection.status === 'connected');
        setSelectedConnectionIds((current) => current.length ? current.filter((id) => connected.some((connection) => connection.id === id)) : connected[0] ? [connected[0].id] : []);
      })
      .catch((error) => active && setDataError(readableError(error)));

    return () => { active = false; };
  }, [workspaceId, refreshIndex]);

  useEffect(() => {
    if (!workspaceId || !runtime.publishingSchedulerReady) {
      setPublications([]);
      return undefined;
    }
    let active = true;
    setPublicationsLoading(true);
    setPublicationsError(undefined);
    apiRequest<PublicationsPayload>('/api/publications', {}, workspaceId)
      .then((payload) => active && setPublications(payload.publications))
      .catch((error) => active && setPublicationsError(readableError(error)))
      .finally(() => active && setPublicationsLoading(false));
    return () => { active = false; };
  }, [workspaceId, runtime.publishingSchedulerReady, refreshIndex]);

  useEffect(() => {
    if (!workspaceId || !selectedConversationId) {
      setMessages(undefined);
      return undefined;
    }
    let active = true;
    setMessagesLoading(true);
    setMessagesError(undefined);
    apiRequest<MessagesPayload>(
      `/api/inbox/conversations/${encodeURIComponent(selectedConversationId)}/messages?limit=50`,
      {},
      workspaceId,
    )
      .then((payload) => active && setMessages(payload))
      .catch((error) => active && setMessagesError(readableError(error)))
      .finally(() => active && setMessagesLoading(false));
    return () => { active = false; };
  }, [workspaceId, selectedConversationId]);

  const selectedWorkspace = useMemo(
    () => workspaces?.find((workspace) => workspace.id === workspaceId),
    [workspaces, workspaceId],
  );

  const selectedConversation = useMemo(
    () => inbox?.conversations.find((conversation) => conversation.id === selectedConversationId),
    [inbox, selectedConversationId],
  );

  const filteredConversations = useMemo(() => {
    if (!inbox) return [];
    return inbox.conversations.filter((conversation) => {
      const text = `${conversation.contactName} ${conversation.handle ?? ''} ${conversation.latestMessage?.body ?? ''}`.toLowerCase();
      if (!text.includes(query.toLowerCase())) return false;
      const type = conversation.latestMessage?.type ?? 'message';
      if (inboxFilter === 'comments') return type === 'comment';
      if (inboxFilter === 'messages') return type !== 'comment';
      return true;
    });
  }, [inbox, inboxFilter, query]);

  const connectedConnections = useMemo(
    () => bootstrap?.connections.filter((connection) => connection.status === 'connected') ?? [],
    [bootstrap],
  );

  const orderedPublications = useMemo(
    () => [...publications].filter((publication) => publication.status !== 'cancelled').sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
    [publications],
  );

  function navigate(nextPage: Page) {
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !selectedConversation || !reply.trim() || replyBusy) return;
    if (!runtime.outboundReady) {
      setToast('Ce compte n’est pas encore autorisé à envoyer depuis Social Conversion.');
      return;
    }
    const body = reply.trim();
    setReplyBusy(true);
    try {
      await apiRequest(
        '/api/messages',
        {
          method: 'POST',
          body: JSON.stringify({
            conversationId: selectedConversation.id,
            message: body,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
        workspaceId,
      );
      const now = new Date().toISOString();
      setMessages((current) => current ? {
        ...current,
        messages: [{
          id: `local-${crypto.randomUUID()}`,
          direction: 'outbound',
          type: 'message',
          body,
          status: 'pending',
          aiAssisted: false,
          sentAt: now,
          createdAt: now,
        }, ...current.messages],
      } : current);
      setReply('');
      setToast('Réponse transmise au connecteur social.');
    } catch (error) {
      setToast(readableError(error));
    } finally {
      setReplyBusy(false);
    }
  }

  async function suggestReply() {
    if (!workspaceId || !selectedConversation || aiBusy) return;
    if (!runtime.aiReady) {
      setToast('Le copilote IA n’est pas encore configuré.');
      return;
    }
    setAiBusy(true);
    try {
      const result = await apiRequest<AiDraftPayload>(
        '/api/ai/suggest',
        { method: 'POST', body: JSON.stringify({ conversationId: selectedConversation.id }) },
        workspaceId,
      );
      setReply(result.draft.body);
      setToast('Brouillon généré. Vous gardez le contrôle avant envoi.');
    } catch (error) {
      setToast(readableError(error));
    } finally {
      setAiBusy(false);
    }
  }

  function toggleConnection(id: string) {
    setSelectedConnectionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function resetComposer() {
    setPublishBody('');
    setTiming('later');
    setScheduleDate(tomorrowKey());
    setScheduleTime('10:00');
    setSelectedConnectionIds(connectedConnections[0] ? [connectedConnections[0].id] : []);
  }

  async function schedulePublication() {
    if (!workspaceId || publishBusy) return;
    if (!runtime.publishingSchedulerReady) {
      setToast('La programmation live n’est pas encore activée.');
      return;
    }
    if (!publishBody.trim()) {
      setToast('Ajoutez le contenu de la publication.');
      return;
    }
    if (selectedConnectionIds.length === 0) {
      setToast('Choisissez au moins un compte connecté.');
      return;
    }

    const scheduledAt = timing === 'now'
      ? new Date(Date.now() + 30_000).toISOString()
      : new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();

    setPublishBusy(true);
    try {
      const result = await apiRequest<{ publication: Publication }>(
        '/api/publications',
        {
          method: 'POST',
          body: JSON.stringify({
            body: publishBody.trim(),
            scheduledAt,
            connectionIds: selectedConnectionIds,
          }),
        },
        workspaceId,
      );
      setPublications((current) => [...current, result.publication]);
      resetComposer();
      navigate('calendar');
      setToast(runtime.contentPublishingReady
        ? 'Publication programmée.'
        : 'Programmation enregistrée. La diffusion externe reste verrouillée tant que le connecteur de publication n’est pas validé.');
    } catch (error) {
      setToast(readableError(error));
    } finally {
      setPublishBusy(false);
    }
  }

  async function editPublication(publication: Publication) {
    if (!workspaceId || publishBusy) return;
    setPublishBusy(true);
    try {
      await apiRequest(
        `/api/publications/${encodeURIComponent(publication.id)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ expectedVersion: publication.version }),
        },
        workspaceId,
      );
      setPublications((current) => current.filter((candidate) => candidate.id !== publication.id));
      setPublishBody(publication.body);
      setSelectedConnectionIds(publication.targets.map((target) => target.connectionId));
      const date = new Date(publication.scheduledAt);
      setScheduleDate(localDateKey(date));
      setScheduleTime(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
      setTiming('later');
      navigate('publish');
      setToast('Ancienne programmation annulée. Modifiez puis reprogrammez.');
    } catch (error) {
      setToast(readableError(error));
    } finally {
      setPublishBusy(false);
    }
  }

  if (workspaceError) return <Gate title="Accès impossible" body={workspaceError} danger />;
  if (!workspaces) return <Gate title="Vérification de votre accès" body="Chargement des espaces autorisés…" loading />;
  if (workspaces.length === 0) return <Gate title="Aucun espace autorisé" body="Votre identité est valide, mais aucun espace Social Conversion ne vous est attribué." danger />;

  if (!workspaceId) {
    return (
      <main className="live-gate-simple">
        <section className="live-workspace-picker-simple">
          <span className="brand-orbit">N</span>
          <span className="eyebrow">Social Conversion</span>
          <h1>Choisissez votre espace</h1>
          <p>Chaque espace garde ses comptes, conversations et publications séparés.</p>
          <div>
            {workspaces.map((workspace) => (
              <button key={workspace.id} onClick={() => setWorkspaceId(workspace.id)}>
                <span><strong>{workspace.name}</strong><small>{workspace.role}</small></span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (dataError) {
    return <Gate title="Données indisponibles" body={dataError} danger action={() => setRefreshIndex((value) => value + 1)} />;
  }

  if (!session || !bootstrap || !inbox) {
    return <Gate title={`Ouverture de ${selectedWorkspace?.name ?? 'votre espace'}`} body="Chargement des données réelles…" loading />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('inbox')} aria-label="Social Conversion">
          <span className="brand-orbit">N</span>
          <span><strong>Social</strong><small>Conversion</small></span>
        </button>
        <nav className="main-nav" aria-label="Navigation principale">
          {mainNav.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>
                <span className="nav-icon"><Icon size={19} /></span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-mini">
            <span className="pulse-dot" />
            <span><strong>{connectedConnections.length} compte{connectedConnections.length > 1 ? 's' : ''} prêt{connectedConnections.length > 1 ? 's' : ''}</strong><small>{session.workspace.name}</small></span>
          </div>
          <button className={`settings-link ${page === 'more' ? 'active' : ''}`} onClick={() => navigate('more')}><Settings2 size={18} /> Réglages avancés</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-orbit">N</span><strong>Social Conversion</strong></div>
          <div className="topbar-title"><strong>{page === 'inbox' ? 'Inbox' : page === 'publish' ? 'Créer une publication' : page === 'calendar' ? 'Calendrier' : page === 'results' ? 'Résultats' : 'Réglages avancés'}</strong><small>{session.workspace.name} · live</small></div>
          <div className="topbar-actions">
            <button className="icon-only mobile-settings" onClick={() => navigate('more')} aria-label="Réglages"><Settings2 size={19} /></button>
            <button className="create-button" onClick={() => navigate('publish')}><Plus size={17} /> Créer</button>
          </div>
        </header>

        <main className="page-content">
          {page === 'inbox' && (
            <LiveInbox
              conversations={filteredConversations}
              selected={selectedConversation}
              messages={messages}
              messagesLoading={messagesLoading}
              messagesError={messagesError}
              query={query}
              filter={inboxFilter}
              reply={reply}
              outboundReady={runtime.outboundReady}
              aiReady={runtime.aiReady}
              busy={replyBusy || aiBusy}
              onQuery={setQuery}
              onFilter={setInboxFilter}
              onSelect={setSelectedConversationId}
              onReply={setReply}
              onSend={sendReply}
              onSuggest={() => void suggestReply()}
            />
          )}

          {page === 'publish' && (
            <LivePublish
              body={publishBody}
              connections={bootstrap.connections}
              selectedConnectionIds={selectedConnectionIds}
              timing={timing}
              scheduleDate={scheduleDate}
              scheduleTime={scheduleTime}
              schedulerReady={Boolean(runtime.publishingSchedulerReady)}
              deliveryReady={Boolean(runtime.contentPublishingReady)}
              busy={publishBusy}
              onBody={setPublishBody}
              onToggleConnection={toggleConnection}
              onTiming={setTiming}
              onScheduleDate={setScheduleDate}
              onScheduleTime={setScheduleTime}
              onSchedule={() => void schedulePublication()}
            />
          )}

          {page === 'calendar' && (
            <LiveCalendar
              publications={orderedPublications}
              loading={publicationsLoading}
              error={publicationsError}
              deliveryReady={Boolean(runtime.contentPublishingReady)}
              onEdit={(publication) => void editPublication(publication)}
              onCreate={() => navigate('publish')}
            />
          )}

          {page === 'results' && <LiveResults bootstrap={bootstrap} />}
          {page === 'more' && <LiveMore session={session} bootstrap={bootstrap} runtime={runtime} workspaces={workspaces} onChangeWorkspace={() => setWorkspaceId(undefined)} onRefresh={() => setRefreshIndex((value) => value + 1)} />}
        </main>
      </section>

      <nav className="mobile-nav" aria-label="Navigation mobile">
        {mainNav.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.label}</span></button>;
        })}
      </nav>

      {toast && <Toast text={toast} onClose={() => setToast('')} />}
    </div>
  );
}

function LiveInbox({
  conversations,
  selected,
  messages,
  messagesLoading,
  messagesError,
  query,
  filter,
  reply,
  outboundReady,
  aiReady,
  busy,
  onQuery,
  onFilter,
  onSelect,
  onReply,
  onSend,
  onSuggest,
}: {
  conversations: LiveConversation[];
  selected?: LiveConversation;
  messages?: MessagesPayload;
  messagesLoading: boolean;
  messagesError?: string;
  query: string;
  filter: InboxFilter;
  reply: string;
  outboundReady: boolean;
  aiReady: boolean;
  busy: boolean;
  onQuery: (value: string) => void;
  onFilter: (value: InboxFilter) => void;
  onSelect: (id: string) => void;
  onReply: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onSuggest: () => void;
}) {
  return (
    <div className="inbox-layout">
      <section className="inbox-list-panel">
        <div className="page-intro compact"><div><span className="eyebrow">Tout au même endroit</span><h1>À qui répondre ?</h1></div></div>
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Rechercher une personne…" /></label>
        <div className="filter-row">
          {([['all', 'Tout'], ['messages', 'Messages'], ['comments', 'Commentaires']] as Array<[InboxFilter, string]>).map(([value, label]) => (
            <button key={value} className={filter === value ? 'active' : ''} onClick={() => onFilter(value)}>{label}</button>
          ))}
        </div>
        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button key={conversation.id} className={`conversation-item ${selected?.id === conversation.id ? 'active' : ''}`} onClick={() => onSelect(conversation.id)}>
              <span className="avatar">{conversation.contactName.slice(0, 2).toUpperCase()}</span>
              <span className="conversation-copy">
                <span><strong>{conversation.contactName}</strong><time>{shortDate(conversation.latestMessage?.sentAt ?? conversation.lastMessageAt)}</time></span>
                <small>{conversation.latestMessage?.body || 'Conversation ouverte'}</small>
                <span className="conversation-source"><PlatformMark platform={conversation.platform} /> {conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName || platformLabel(conversation.platform)}</span>
              </span>
            </button>
          ))}
          {conversations.length === 0 && <div className="empty-simple"><Search size={22} /><strong>Aucune conversation</strong><span>Modifiez le filtre ou attendez une nouvelle interaction.</span></div>}
        </div>
      </section>

      <section className="thread-panel">
        {selected ? (
          <>
            <header className="thread-header">
              <div className="thread-person"><span className="avatar large">{selected.contactName.slice(0, 2).toUpperCase()}</span><span><strong>{selected.contactName}</strong><small>{selected.handle || 'Sans identifiant'} · {platformLabel(selected.platform)}</small></span></div>
              <span className="simple-stage">{selected.leadStage}</span>
            </header>
            <div className="thread-messages">
              {messagesLoading && <div className="live-inline-state"><LoaderCircle className="spin" size={18} /> Chargement…</div>}
              {messagesError && <div className="live-inline-error-simple">{messagesError}</div>}
              {messages && [...messages.messages].reverse().map((message) => (
                <div key={message.id} className={`message ${message.direction}`}>
                  <div>{message.body}</div>
                  <small>{shortDate(message.sentAt)}{message.aiAssisted ? ' · assisté IA' : ''}{message.status === 'pending' ? ' · envoi en cours' : ''}</small>
                </div>
              ))}
              {messages && messages.messages.length === 0 && <div className="empty-thread"><MessageCircle size={26} /><strong>Aucun message</strong></div>}
            </div>
            <div className="reply-area">
              <button className="ai-shortcut" onClick={onSuggest} disabled={!aiReady || busy}><Sparkles size={16} /> {busy ? 'Préparation…' : 'Proposer une réponse'}</button>
              <form onSubmit={onSend}>
                <span className="composer-icon"><MessageCircle size={18} /></span>
                <textarea value={reply} onChange={(event) => onReply(event.target.value)} placeholder={outboundReady ? 'Écrire une réponse…' : 'Envoi verrouillé pour le moment'} rows={2} disabled={!outboundReady || busy} />
                <button className="send-button" type="submit" disabled={!outboundReady || busy || !reply.trim()} aria-label="Envoyer"><Send size={18} /></button>
              </form>
              {!outboundReady && <small className="reply-note">Lecture active. L’envoi apparaîtra dès que le connecteur sortant sera validé.</small>}
            </div>
          </>
        ) : <div className="empty-thread"><MessageCircle size={28} /><strong>Choisissez une conversation</strong><span>Messages et commentaires arrivent ici.</span></div>}
      </section>

      {selected && (
        <aside className="contact-panel">
          <span className="avatar xlarge">{selected.contactName.slice(0, 2).toUpperCase()}</span>
          <h3>{selected.contactName}</h3>
          <p>{selected.handle || platformLabel(selected.platform)}</p>
          <div className="contact-facts">
            <span><small>Intention</small><strong>{selected.intent || 'À qualifier'}</strong></span>
            <span><small>Étape</small><strong>{selected.leadStage}</strong></span>
            <span><small>Valeur estimée</small><strong>{selected.estimatedValueCents ? `${(selected.estimatedValueCents / 100).toLocaleString('fr-FR')} €` : 'À qualifier'}</strong></span>
          </div>
        </aside>
      )}
    </div>
  );
}

function LivePublish({
  body,
  connections,
  selectedConnectionIds,
  timing,
  scheduleDate,
  scheduleTime,
  schedulerReady,
  deliveryReady,
  busy,
  onBody,
  onToggleConnection,
  onTiming,
  onScheduleDate,
  onScheduleTime,
  onSchedule,
}: {
  body: string;
  connections: LiveConnection[];
  selectedConnectionIds: string[];
  timing: PublishTiming;
  scheduleDate: string;
  scheduleTime: string;
  schedulerReady: boolean;
  deliveryReady: boolean;
  busy: boolean;
  onBody: (value: string) => void;
  onToggleConnection: (id: string) => void;
  onTiming: (value: PublishTiming) => void;
  onScheduleDate: (value: string) => void;
  onScheduleTime: (value: string) => void;
  onSchedule: () => void;
}) {
  return (
    <div className="publish-page">
      <div className="page-intro"><div><span className="eyebrow">3 étapes, pas plus</span><h1>Créer une publication</h1><p>Écrivez, choisissez les comptes, programmez.</p></div></div>

      {!deliveryReady && (
        <div className="live-safety-banner"><AlertTriangle size={17} /><span><strong>Programmation disponible, diffusion externe encore verrouillée.</strong><small>Social Conversion enregistre le planning réel sans prétendre qu’un réseau a publié tant que son connecteur n’est pas validé.</small></span></div>
      )}

      <section className="composer-card">
        <div className="section-heading"><span className="section-number">1</span><div><h2>Votre contenu</h2><p>Le texte qui servira de base à la publication.</p></div></div>
        <textarea className="caption-box" value={body} onChange={(event) => onBody(event.target.value)} placeholder="Qu’est-ce que vous voulez publier ?" maxLength={5000} />
        <div className="adapt-row disabled-feature"><span><Video size={17} /><span><strong>Médias</strong><small>L’upload R2 sera activé avec le premier connecteur de publication validé.</small></span></span><span className="coming-soon">À brancher</span></div>
      </section>

      <section className="publish-section">
        <div className="section-heading"><span className="section-number">2</span><div><h2>Où publier ?</h2><p>Seuls les comptes réellement connectés sont sélectionnables.</p></div></div>
        <div className="account-picker">
          {connections.map((connection) => {
            const selected = selectedConnectionIds.includes(connection.id);
            const connected = connection.status === 'connected';
            return (
              <button key={connection.id} className={`account-choice ${selected ? 'selected' : ''} ${!connected ? 'disabled' : ''}`} disabled={!connected} onClick={() => onToggleConnection(connection.id)}>
                <PlatformMark platform={connection.platform} />
                <span><strong>{connection.displayName}</strong><small>{platformLabel(connection.platform)} · {connection.handle || 'identifiant non renseigné'}</small></span>
                <span className={`choice-state ${selected ? 'selected' : ''}`}>{connected ? (selected ? <Check size={14} /> : '') : 'À vérifier'}</span>
              </button>
            );
          })}
          {connections.length === 0 && <div className="calendar-empty compact-empty"><Link2 size={24} /><strong>Aucun compte connecté</strong><span>Connectez d’abord un compte social.</span></div>}
        </div>
      </section>

      <section className="publish-section timing-section">
        <div className="section-heading"><span className="section-number">3</span><div><h2>Quand ?</h2><p>Maintenant ou à une date précise.</p></div></div>
        <div className="timing-options">
          <button className={timing === 'now' ? 'active' : ''} onClick={() => onTiming('now')}><Zap size={18} /><span><strong>Maintenant</strong><small>Planifier immédiatement</small></span></button>
          <button className={timing === 'later' ? 'active' : ''} onClick={() => onTiming('later')}><CalendarDays size={18} /><span><strong>Programmer</strong><small>Choisir la date et l’heure</small></span></button>
          {timing === 'later' && <div className="datetime-fields"><label><span>Date</span><input type="date" value={scheduleDate} min={localDateKey(new Date())} onChange={(event) => onScheduleDate(event.target.value)} /></label><label><span>Heure</span><input type="time" value={scheduleTime} onChange={(event) => onScheduleTime(event.target.value)} /></label></div>}
        </div>
        <div className="publish-submit-row">
          <span><Check size={16} /><strong>{selectedConnectionIds.length}</strong> compte{selectedConnectionIds.length > 1 ? 's' : ''} sélectionné{selectedConnectionIds.length > 1 ? 's' : ''}</span>
          <button className="primary-large" disabled={!schedulerReady || busy} onClick={onSchedule}>{busy ? 'Enregistrement…' : deliveryReady ? (timing === 'now' ? 'Publier maintenant' : 'Programmer la publication') : 'Enregistrer la programmation'} <ChevronRight size={17} /></button>
        </div>
      </section>
    </div>
  );
}

function LiveCalendar({ publications, loading, error, deliveryReady, onEdit, onCreate }: { publications: Publication[]; loading: boolean; error?: string; deliveryReady: boolean; onEdit: (publication: Publication) => void; onCreate: () => void }) {
  const grouped = useMemo(() => {
    const map = new Map<string, Publication[]>();
    publications.forEach((publication) => {
      const key = localDateKey(new Date(publication.scheduledAt));
      map.set(key, [...(map.get(key) ?? []), publication]);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [publications]);

  return (
    <div className="calendar-page">
      <div className="page-intro"><div><span className="eyebrow">Planning réel</span><h1>Ce qui est programmé</h1><p>Chaque ligne correspond à une programmation enregistrée dans votre espace.</p></div><button className="primary-small" onClick={onCreate}><Plus size={16} /> Nouvelle publication</button></div>
      {!deliveryReady && <div className="live-safety-banner compact-banner"><AlertTriangle size={16} /><span><strong>Diffusion automatique non activée</strong><small>Les programmations sont conservées, mais aucune publication externe n’est déclarée réussie.</small></span></div>}
      {loading && <div className="live-inline-state"><LoaderCircle className="spin" size={18} /> Chargement du calendrier…</div>}
      {error && <div className="live-inline-error-simple">{error}</div>}
      {!loading && !error && (
        <section className="timeline">
          {grouped.map(([date, dayPosts]) => (
            <div className="timeline-day" key={date}>
              <div className="day-label"><strong>{new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(new Date(`${date}T12:00:00`))}</strong><span>{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`))}</span></div>
              <div className="day-posts">
                {dayPosts.map((publication) => (
                  <article className="scheduled-card" key={publication.id}>
                    <div className="scheduled-time"><Clock3 size={15} /> {new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(publication.scheduledAt))}</div>
                    <div className="scheduled-copy"><strong>{publication.body}</strong><small>{publication.targets.length} diffusion{publication.targets.length > 1 ? 's' : ''} · {publication.status}</small></div>
                    <div className="scheduled-accounts">{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} />)}</div>
                    <button className="edit-button" onClick={() => onEdit(publication)}>Modifier</button>
                  </article>
                ))}
              </div>
            </div>
          ))}
          {grouped.length === 0 && <div className="calendar-empty"><CalendarDays size={28} /><strong>Rien de programmé</strong><span>Créez votre première publication.</span><button onClick={onCreate}>Créer maintenant</button></div>}
        </section>
      )}
    </div>
  );
}

function LiveResults({ bootstrap }: { bootstrap: LiveBootstrap }) {
  return (
    <div className="results-page">
      <div className="page-intro"><div><span className="eyebrow">Données réelles</span><h1>Ce qui se passe sur vos réseaux</h1><p>Les indicateurs disponibles aujourd’hui, sans métrique inventée.</p></div></div>
      <section className="result-metrics">
        <article><span>Comptes connectés</span><strong>{bootstrap.metrics.connectedAccounts}</strong><small>comptes réellement actifs</small></article>
        <article><span>Conversations ouvertes</span><strong>{bootstrap.metrics.openConversations}</strong><small>à suivre dans l’Inbox</small></article>
        <article><span>Contacts</span><strong>{bootstrap.metrics.contacts}</strong><small>identités sociales captées</small></article>
        <article className="highlight"><span>Pipeline estimé</span><strong>{(bootstrap.metrics.estimatedPipelineCents / 100).toLocaleString('fr-FR')} €</strong><small>opportunités non gagnées/perdues</small></article>
      </section>
      <section className="results-table-card">
        <div className="section-heading simple"><div><h2>État des canaux</h2><p>Les analyses de performance éditoriale apparaîtront lorsque les connecteurs de publication et leurs insights seront actifs.</p></div></div>
        <div className="results-table">
          <div className="results-head"><span>Compte</span><span>Réseau</span><span>Statut</span><span>Sync</span></div>
          {bootstrap.connections.map((connection) => (
            <div className="results-row" key={connection.id}><span><strong>{connection.displayName}</strong><small>{connection.handle || 'Sans identifiant'}</small></span><strong>{platformLabel(connection.platform)}</strong><strong>{connection.status}</strong><strong>{shortDate(connection.lastSyncedAt)}</strong></div>
          ))}
        </div>
      </section>
    </div>
  );
}

function LiveMore({ session, bootstrap, runtime, workspaces, onChangeWorkspace, onRefresh }: { session: SessionPayload; bootstrap: LiveBootstrap; runtime: LiveRuntimeState; workspaces: WorkspaceSummary[]; onChangeWorkspace: () => void; onRefresh: () => void }) {
  return (
    <div className="more-page">
      <div className="page-intro"><div><span className="eyebrow">Secondaire</span><h1>Réglages avancés</h1><p>Le quotidien reste dans quatre écrans. Le technique reste ici.</p></div></div>
      <div className="advanced-grid">
        <article className="advanced-card"><span className="advanced-icon"><Link2 size={20} /></span><div><h3>Comptes connectés</h3><p>{bootstrap.connections.length} compte{bootstrap.connections.length > 1 ? 's' : ''} configuré{bootstrap.connections.length > 1 ? 's' : ''}, dont {bootstrap.metrics.connectedAccounts} actif{bootstrap.metrics.connectedAccounts > 1 ? 's' : ''}.</p></div><button onClick={onRefresh}><RefreshCw size={14} /> Resynchroniser l’état</button></article>
        <article className="advanced-card"><span className="advanced-icon"><MessageCircle size={20} /></span><div><h3>Réponses sortantes</h3><p>{runtime.outboundReady ? 'Connecteur sortant validé.' : 'Lecture active, envoi encore verrouillé.'}</p></div><span className={`runtime-chip ${runtime.outboundReady ? 'ready' : ''}`}>{runtime.outboundReady ? 'Prêt' : 'Bloqué'}</span></article>
        <article className="advanced-card"><span className="advanced-icon"><Sparkles size={20} /></span><div><h3>Copilote IA</h3><p>{runtime.aiReady ? 'Brouillons IA disponibles avec validation humaine.' : 'Fournisseur IA non configuré.'}</p></div><span className={`runtime-chip ${runtime.aiReady ? 'ready' : ''}`}>{runtime.aiReady ? 'Prêt' : 'Bloqué'}</span></article>
        <article className="advanced-card"><span className="advanced-icon"><CalendarDays size={20} /></span><div><h3>Publication programmée</h3><p>{runtime.contentPublishingReady ? 'Planification et diffusion automatiques actives.' : runtime.publishingSchedulerReady ? 'Planning actif, diffusion réseau encore verrouillée.' : 'Planning live non activé.'}</p></div><span className={`runtime-chip ${runtime.contentPublishingReady ? 'ready' : ''}`}>{runtime.contentPublishingReady ? 'Prêt' : 'Partiel'}</span></article>
        <article className="advanced-card"><span className="advanced-icon"><CircleUserRound size={20} /></span><div><h3>Votre accès</h3><p>{session.email ?? session.subject} · rôle {session.workspace.role}.</p></div>{workspaces.length > 1 ? <button onClick={onChangeWorkspace}>Changer d’espace <ChevronRight size={14} /></button> : <span className="runtime-chip ready">{session.workspace.name}</span>}</article>
      </div>
    </div>
  );
}

function Gate({ title, body, danger = false, loading = false, action }: { title: string; body: string; danger?: boolean; loading?: boolean; action?: () => void }) {
  return (
    <main className="live-gate-simple">
      <section className={`live-state-simple ${danger ? 'danger' : ''}`}>
        {loading ? <LoaderCircle className="spin" size={24} /> : danger ? <AlertTriangle size={24} /> : <Check size={24} />}
        <h1>{title}</h1>
        <p>{body}</p>
        {action && <button className="primary-small" onClick={action}><RefreshCw size={15} /> Réessayer</button>}
      </section>
    </main>
  );
}
