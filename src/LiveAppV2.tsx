import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Inbox as InboxIcon,
  LayoutGrid,
  Link2,
  List,
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

export interface LiveRuntimeStateV2 {
  mode: 'live';
  ready: boolean;
  outboundReady: boolean;
  aiReady: boolean;
  instagramOAuthReady?: boolean;
  publishingSchedulerReady?: boolean;
  contentPublishingReady?: boolean;
}

type WorkspaceRole = 'admin' | 'manager' | 'agent' | 'viewer';
type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';
type Page = 'planner' | 'inbox' | 'create' | 'results' | 'settings';
type InboxFilter = 'all' | 'messages' | 'comments';
type PlannerView = 'week' | 'list';
type ActiveAccount = 'all' | string;

type WorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceRole;
  status: 'invited' | 'active';
};

type SessionPayload = {
  subject: string;
  email?: string;
  workspace: { id: string; name: string; role: WorkspaceRole };
};

type LiveConnection = {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  handle?: string;
  status: string;
  lastSyncedAt?: string;
};

type LiveConversation = {
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
};

type LiveBootstrap = {
  workspace: { id: string; name: string; role: WorkspaceRole };
  metrics: {
    contacts: number;
    openConversations: number;
    connectedAccounts: number;
    estimatedPipelineCents: number;
  };
  connections: LiveConnection[];
  recentConversations: LiveConversation[];
};

type InboxPayload = {
  conversations: LiveConversation[];
  page: { limit: number; hasMore: boolean; nextCursor?: string };
};

type ConversationMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  body: string;
  status: string;
  aiAssisted: boolean;
  sentAt: string;
  createdAt: string;
};

type MessagesPayload = {
  conversationId: string;
  messages: ConversationMessage[];
  page: { limit: number; hasMore: boolean; nextCursor?: string };
};

type PublicationTarget = {
  id: string;
  connectionId: string;
  platform: SocialPlatform;
  status: string;
  displayName: string;
  handle?: string;
};

type Publication = {
  id: string;
  body: string;
  mediaReference?: string;
  status: string;
  scheduledAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  targets: PublicationTarget[];
};

type PublicationsPayload = { publications: Publication[] };

type AiDraftPayload = { draft: { id: string; body: string } };

const nav: Array<{ id: Exclude<Page, 'settings'>; label: string; icon: LucideIcon }> = [
  { id: 'planner', label: 'Planner', icon: CalendarDays },
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'create', label: 'Créer', icon: Plus },
  { id: 'results', label: 'Résultats', icon: BarChart3 },
];

function platformLabel(platform: SocialPlatform) {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  return 'TikTok';
}

function PlatformMark({ platform, size = 16 }: { platform: SocialPlatform; size?: number }) {
  const icon = platform === 'instagram'
    ? <Camera size={size} />
    : platform === 'youtube'
      ? <Video size={size} />
      : <Music2 size={size} />;
  return <span className={`sc2-platform sc2-${platform}`}>{icon}</span>;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateAtNoon(key: string) {
  return new Date(`${key}T12:00:00`);
}

function mondayOf(date: Date) {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function tomorrowKey() {
  return localDateKey(addDays(new Date(), 1));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatShortDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function readableError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'OUTBOUND_NOT_READY') return 'L’envoi réel n’est pas encore disponible pour ce compte.';
    if (error.code === 'OAUTH_NOT_CONFIGURED') return 'La connexion Instagram n’est pas encore configurée côté serveur.';
    if (error.code === 'PUBLICATION_CONFLICT') return 'Cette publication a changé ailleurs. Le planner va être rechargé.';
    return error.message;
  }
  return 'Une erreur inattendue empêche cette action.';
}

function Gate({ title, body, loading = false }: { title: string; body: string; loading?: boolean }) {
  return (
    <main className="sc2-gate">
      <section>
        {loading ? <LoaderCircle className="sc2-spin" size={24} /> : <AlertTriangle size={24} />}
        <h1>{title}</h1>
        <p>{body}</p>
      </section>
    </main>
  );
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="sc2-toast" role="status">
      <span><Check size={14} /></span>
      <strong>{text}</strong>
      <button onClick={onClose} aria-label="Fermer"><X size={15} /></button>
    </div>
  );
}

export default function LiveAppV2({ runtime }: { runtime: LiveRuntimeStateV2 }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [session, setSession] = useState<SessionPayload>();
  const [bootstrap, setBootstrap] = useState<LiveBootstrap>();
  const [inbox, setInbox] = useState<InboxPayload>();
  const [publications, setPublications] = useState<Publication[]>([]);
  const [dataError, setDataError] = useState<string>();
  const [loadingPublications, setLoadingPublications] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const [page, setPage] = useState<Page>('planner');
  const [activeAccountId, setActiveAccountId] = useState<ActiveAccount>(() => window.localStorage.getItem('social-conversion.active-account') || 'all');
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [toast, setToast] = useState('');

  const [query, setQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [selectedConversationId, setSelectedConversationId] = useState<string>();
  const [messages, setMessages] = useState<MessagesPayload>();
  const [messagesBusy, setMessagesBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);

  const [plannerView, setPlannerView] = useState<PlannerView>('week');
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [draggedPublicationId, setDraggedPublicationId] = useState<string>();
  const [rescheduleBusy, setRescheduleBusy] = useState(false);

  const [publishBody, setPublishBody] = useState(() => window.localStorage.getItem('social-conversion.compose.body') || '');
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [scheduleDate, setScheduleDate] = useState(tomorrowKey());
  const [scheduleTime, setScheduleTime] = useState('10:00');
  const [publishNow, setPublishNow] = useState(false);
  const [customizePerAccount, setCustomizePerAccount] = useState(false);
  const [accountBodies, setAccountBodies] = useState<Record<string, string>>({});
  const [publishBusy, setPublishBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<{ workspaces: WorkspaceSummary[] }>('/api/workspaces')
      .then(({ workspaces: available }) => {
        if (!active) return;
        setWorkspaces(available);
        const persisted = window.localStorage.getItem('social-conversion.workspace');
        const found = available.find((workspace) => workspace.id === persisted);
        setWorkspaceId(found?.id ?? available[0]?.id);
      })
      .catch((error) => active && setDataError(readableError(error)));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    window.localStorage.setItem('social-conversion.active-account', activeAccountId);
  }, [activeAccountId]);

  useEffect(() => {
    window.localStorage.setItem('social-conversion.compose.body', publishBody);
  }, [publishBody]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let active = true;
    setDataError(undefined);
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
        setSelectedConnectionIds((current) => current.filter((id) => connected.some((connection) => connection.id === id)).length
          ? current.filter((id) => connected.some((connection) => connection.id === id))
          : connected[0] ? [connected[0].id] : []);
        if (activeAccountId !== 'all' && !connected.some((connection) => connection.id === activeAccountId)) {
          setActiveAccountId('all');
        }
      })
      .catch((error) => active && setDataError(readableError(error)));
    return () => { active = false; };
  }, [workspaceId, refreshIndex]);

  useEffect(() => {
    if (!workspaceId || !runtime.publishingSchedulerReady) return undefined;
    let active = true;
    setLoadingPublications(true);
    apiRequest<PublicationsPayload>('/api/publications', {}, workspaceId)
      .then((payload) => active && setPublications(payload.publications))
      .catch((error) => active && setToast(readableError(error)))
      .finally(() => active && setLoadingPublications(false));
    return () => { active = false; };
  }, [workspaceId, runtime.publishingSchedulerReady, refreshIndex]);

  useEffect(() => {
    if (!workspaceId || !selectedConversationId) {
      setMessages(undefined);
      return undefined;
    }
    let active = true;
    setMessagesBusy(true);
    apiRequest<MessagesPayload>(`/api/inbox/conversations/${encodeURIComponent(selectedConversationId)}/messages?limit=50`, {}, workspaceId)
      .then((payload) => active && setMessages(payload))
      .catch((error) => active && setToast(readableError(error)))
      .finally(() => active && setMessagesBusy(false));
    return () => { active = false; };
  }, [workspaceId, selectedConversationId]);

  const connections = useMemo(() => bootstrap?.connections ?? [], [bootstrap]);
  const connectedConnections = useMemo(() => connections.filter((connection) => connection.status === 'connected'), [connections]);
  const activeConnection = useMemo(
    () => activeAccountId === 'all' ? undefined : connectedConnections.find((connection) => connection.id === activeAccountId),
    [activeAccountId, connectedConnections],
  );

  const visiblePublications = useMemo(() => publications.filter((publication) => {
    if (publication.status === 'cancelled') return false;
    if (activeAccountId === 'all') return true;
    return publication.targets.some((target) => target.connectionId === activeAccountId);
  }).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()), [publications, activeAccountId]);

  const visibleConversations = useMemo(() => {
    if (!inbox) return [];
    const accountName = activeConnection?.displayName;
    return inbox.conversations.filter((conversation) => {
      if (accountName && conversation.accountName !== accountName) return false;
      const haystack = `${conversation.contactName} ${conversation.handle ?? ''} ${conversation.latestMessage?.body ?? ''}`.toLowerCase();
      if (!haystack.includes(query.trim().toLowerCase())) return false;
      const type = conversation.latestMessage?.type ?? 'message';
      if (inboxFilter === 'comments') return type === 'comment';
      if (inboxFilter === 'messages') return type !== 'comment';
      return true;
    });
  }, [inbox, activeConnection, query, inboxFilter]);

  const selectedConversation = useMemo(
    () => inbox?.conversations.find((conversation) => conversation.id === selectedConversationId),
    [inbox, selectedConversationId],
  );

  function navigate(next: Page) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchAccount(id: ActiveAccount) {
    setActiveAccountId(id);
    if (id !== 'all' && page === 'create') setSelectedConnectionIds([id]);
  }

  async function connectInstagram(connectionId?: string) {
    if (!workspaceId) return;
    if (!runtime.instagramOAuthReady) {
      setToast('La connexion Instagram n’est pas encore configurée côté serveur.');
      return;
    }
    try {
      const result = await apiRequest<{ url: string }>('/api/oauth/instagram/start', {
        method: 'POST',
        body: JSON.stringify(connectionId ? { connectionId } : {}),
      }, workspaceId);
      window.location.assign(result.url);
    } catch (error) {
      setToast(readableError(error));
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !selectedConversation || !reply.trim() || replyBusy) return;
    if (!runtime.outboundReady) {
      setToast('La lecture est active, mais l’envoi réel est encore verrouillé.');
      return;
    }
    setReplyBusy(true);
    try {
      await apiRequest('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          message: reply.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      }, workspaceId);
      setReply('');
      setToast('Réponse transmise.');
      setRefreshIndex((value) => value + 1);
    } catch (error) {
      setToast(readableError(error));
    } finally {
      setReplyBusy(false);
    }
  }

  async function suggestReply() {
    if (!workspaceId || !selectedConversation) return;
    if (!runtime.aiReady) {
      setToast('Le copilote IA n’est pas encore configuré.');
      return;
    }
    try {
      const result = await apiRequest<AiDraftPayload>('/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify({ conversationId: selectedConversation.id }),
      }, workspaceId);
      setReply(result.draft.body);
    } catch (error) {
      setToast(readableError(error));
    }
  }

  function openCreateForDate(dateKey?: string) {
    if (dateKey) setScheduleDate(dateKey);
    if (activeAccountId !== 'all') setSelectedConnectionIds([activeAccountId]);
    navigate('create');
  }

  function resetComposer() {
    setPublishBody('');
    window.localStorage.removeItem('social-conversion.compose.body');
    setAccountBodies({});
    setCustomizePerAccount(false);
    setPublishNow(false);
    setScheduleDate(tomorrowKey());
    setScheduleTime('10:00');
    setSelectedConnectionIds(activeAccountId !== 'all'
      ? [activeAccountId]
      : connectedConnections[0] ? [connectedConnections[0].id] : []);
  }

  async function schedulePublication() {
    if (!workspaceId || publishBusy) return;
    if (!runtime.publishingSchedulerReady) {
      setToast('Le planner live n’est pas encore activé.');
      return;
    }
    const body = publishBody.trim();
    if (!body) {
      setToast('Écrivez le contenu de la publication.');
      return;
    }
    if (!selectedConnectionIds.length) {
      setToast('Choisissez au moins un compte.');
      return;
    }

    const scheduledAt = publishNow
      ? new Date(Date.now() + 30_000).toISOString()
      : new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
    if (new Date(scheduledAt).getTime() < Date.now() - 30_000) {
      setToast('Choisissez une date et une heure futures.');
      return;
    }

    setPublishBusy(true);
    try {
      const created: Publication[] = [];
      if (customizePerAccount && selectedConnectionIds.length > 1) {
        for (const connectionId of selectedConnectionIds) {
          const result = await apiRequest<{ publication: Publication }>('/api/publications', {
            method: 'POST',
            body: JSON.stringify({
              body: (accountBodies[connectionId] ?? body).trim() || body,
              scheduledAt,
              connectionIds: [connectionId],
            }),
          }, workspaceId);
          created.push(result.publication);
        }
      } else {
        const result = await apiRequest<{ publication: Publication }>('/api/publications', {
          method: 'POST',
          body: JSON.stringify({ body, scheduledAt, connectionIds: selectedConnectionIds }),
        }, workspaceId);
        created.push(result.publication);
      }
      setPublications((current) => [...current, ...created]);
      resetComposer();
      navigate('planner');
      setToast(runtime.contentPublishingReady ? 'Publication programmée.' : 'Programmation enregistrée dans le planner.');
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
      await apiRequest(`/api/publications/${encodeURIComponent(publication.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion: publication.version }),
      }, workspaceId);
      setPublications((current) => current.filter((candidate) => candidate.id !== publication.id));
      const date = new Date(publication.scheduledAt);
      setPublishBody(publication.body);
      setSelectedConnectionIds(publication.targets.map((target) => target.connectionId));
      setScheduleDate(localDateKey(date));
      setScheduleTime(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
      setPublishNow(false);
      navigate('create');
      setToast('Publication ouverte en modification.');
    } catch (error) {
      setToast(readableError(error));
    } finally {
      setPublishBusy(false);
    }
  }

  async function movePublication(publication: Publication, targetDateKey: string) {
    if (!workspaceId || rescheduleBusy) return;
    const old = new Date(publication.scheduledAt);
    const next = new Date(`${targetDateKey}T${String(old.getHours()).padStart(2, '0')}:${String(old.getMinutes()).padStart(2, '0')}:00`);
    if (next.getTime() < Date.now() - 30_000) {
      setToast('Impossible de déplacer une publication dans le passé.');
      return;
    }
    setRescheduleBusy(true);
    try {
      const result = await apiRequest<{ publication: Publication }>(`/api/publications/${encodeURIComponent(publication.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledAt: next.toISOString(), expectedVersion: publication.version }),
      }, workspaceId);
      setPublications((current) => current.map((candidate) => candidate.id === publication.id ? result.publication : candidate));
      setToast(`Déplacée au ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(next)}.`);
    } catch (error) {
      setToast(readableError(error));
      setRefreshIndex((value) => value + 1);
    } finally {
      setRescheduleBusy(false);
      setDraggedPublicationId(undefined);
    }
  }

  if (dataError) return <Gate title="Social Conversion indisponible" body={dataError} />;
  if (!workspaces || !workspaceId || !session || !bootstrap || !inbox) {
    return <Gate title="Ouverture de Social Conversion" body="Chargement de votre espace et de vos comptes…" loading />;
  }

  return (
    <div className="sc2-shell">
      <aside className="sc2-sidebar">
        <button className="sc2-brand" onClick={() => navigate('planner')}>
          <span>N</span><strong>Social<br /><small>Conversion</small></strong>
        </button>
        <nav>
          {nav.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sc2-side-bottom">
          <button className={page === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><Settings2 size={18} /> <span>Réglages</span></button>
        </div>
      </aside>

      <section className="sc2-workspace">
        <header className="sc2-topbar">
          <div className="sc2-title">
            <strong>{page === 'planner' ? 'Planner' : page === 'inbox' ? 'Inbox' : page === 'create' ? 'Créer' : page === 'results' ? 'Résultats' : 'Réglages'}</strong>
            <small>{session.workspace.name}</small>
          </div>
          <div className="sc2-top-actions">
            <AccountSwitcher
              connections={connectedConnections}
              activeId={activeAccountId}
              onSwitch={switchAccount}
              onManage={() => setAccountPanelOpen(true)}
            />
            <button className="sc2-create" onClick={() => openCreateForDate()}><Plus size={16} /> Créer</button>
          </div>
        </header>

        <main className="sc2-content">
          <AccountRail
            connections={connectedConnections}
            activeId={activeAccountId}
            onSwitch={switchAccount}
            onAdd={() => setAccountPanelOpen(true)}
          />

          {page === 'planner' && (
            <PlannerPage
              publications={visiblePublications}
              weekStart={weekStart}
              view={plannerView}
              loading={loadingPublications}
              draggedPublicationId={draggedPublicationId}
              onWeek={setWeekStart}
              onView={setPlannerView}
              onCreate={openCreateForDate}
              onEdit={(publication) => void editPublication(publication)}
              onDragStart={setDraggedPublicationId}
              onDrop={(publication, dateKey) => void movePublication(publication, dateKey)}
              accountLabel={activeConnection?.displayName ?? 'Tous les comptes'}
            />
          )}

          {page === 'inbox' && (
            <InboxPage
              conversations={visibleConversations}
              selected={selectedConversation}
              messages={messages}
              loading={messagesBusy}
              query={query}
              filter={inboxFilter}
              reply={reply}
              outboundReady={runtime.outboundReady}
              aiReady={runtime.aiReady}
              onQuery={setQuery}
              onFilter={setInboxFilter}
              onSelect={setSelectedConversationId}
              onReply={setReply}
              onSend={sendReply}
              onSuggest={() => void suggestReply()}
            />
          )}

          {page === 'create' && (
            <CreatePage
              body={publishBody}
              connections={connectedConnections}
              selectedIds={selectedConnectionIds}
              scheduleDate={scheduleDate}
              scheduleTime={scheduleTime}
              publishNow={publishNow}
              customize={customizePerAccount}
              accountBodies={accountBodies}
              busy={publishBusy}
              deliveryReady={Boolean(runtime.contentPublishingReady)}
              onBody={setPublishBody}
              onToggle={(id) => setSelectedConnectionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
              onDate={setScheduleDate}
              onTime={setScheduleTime}
              onNow={setPublishNow}
              onCustomize={setCustomizePerAccount}
              onAccountBody={(id, value) => setAccountBodies((current) => ({ ...current, [id]: value }))}
              onSchedule={() => void schedulePublication()}
            />
          )}

          {page === 'results' && <ResultsPage bootstrap={bootstrap} activeAccountId={activeAccountId} />}
          {page === 'settings' && (
            <SettingsPage
              session={session}
              connections={connections}
              runtime={runtime}
              onConnectInstagram={(id) => void connectInstagram(id)}
              onRefresh={() => setRefreshIndex((value) => value + 1)}
            />
          )}
        </main>
      </section>

      <nav className="sc2-mobile-nav">
        {nav.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.label}</span></button>;
        })}
      </nav>

      {accountPanelOpen && (
        <AccountPanel
          connections={connections}
          instagramReady={Boolean(runtime.instagramOAuthReady)}
          onClose={() => setAccountPanelOpen(false)}
          onConnectInstagram={(id) => void connectInstagram(id)}
          onSwitch={(id) => { switchAccount(id); setAccountPanelOpen(false); }}
        />
      )}
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
    </div>
  );
}

function AccountSwitcher({ connections, activeId, onSwitch, onManage }: {
  connections: LiveConnection[];
  activeId: ActiveAccount;
  onSwitch: (id: ActiveAccount) => void;
  onManage: () => void;
}) {
  return (
    <div className="sc2-account-switcher">
      <select value={activeId} onChange={(event) => onSwitch(event.target.value)} aria-label="Compte social actif">
        <option value="all">Tous les comptes</option>
        {connections.map((connection) => <option key={connection.id} value={connection.id}>{platformLabel(connection.platform)} · {connection.displayName}</option>)}
      </select>
      <button onClick={onManage} aria-label="Gérer les comptes"><Settings2 size={16} /></button>
    </div>
  );
}

function AccountRail({ connections, activeId, onSwitch, onAdd }: {
  connections: LiveConnection[];
  activeId: ActiveAccount;
  onSwitch: (id: ActiveAccount) => void;
  onAdd: () => void;
}) {
  return (
    <div className="sc2-account-rail" aria-label="Comptes sociaux">
      <button className={activeId === 'all' ? 'active' : ''} onClick={() => onSwitch('all')}><span className="sc2-all-mark">∞</span><span><strong>Tous</strong><small>{connections.length} comptes</small></span></button>
      {connections.map((connection) => (
        <button key={connection.id} className={activeId === connection.id ? 'active' : ''} onClick={() => onSwitch(connection.id)}>
          <PlatformMark platform={connection.platform} />
          <span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span>
        </button>
      ))}
      <button className="sc2-add-account" onClick={onAdd}><Plus size={16} /><span><strong>Ajouter</strong><small>un compte</small></span></button>
    </div>
  );
}

function PlannerPage({ publications, weekStart, view, loading, draggedPublicationId, onWeek, onView, onCreate, onEdit, onDragStart, onDrop, accountLabel }: {
  publications: Publication[];
  weekStart: Date;
  view: PlannerView;
  loading: boolean;
  draggedPublicationId?: string;
  onWeek: (date: Date) => void;
  onView: (view: PlannerView) => void;
  onCreate: (dateKey?: string) => void;
  onEdit: (publication: Publication) => void;
  onDragStart: (id?: string) => void;
  onDrop: (publication: Publication, dateKey: string) => void;
  accountLabel: string;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const byDay = useMemo(() => {
    const map = new Map<string, Publication[]>();
    publications.forEach((publication) => {
      const key = localDateKey(new Date(publication.scheduledAt));
      map.set(key, [...(map.get(key) ?? []), publication]);
    });
    return map;
  }, [publications]);
  const dragged = publications.find((publication) => publication.id === draggedPublicationId);
  const end = addDays(weekStart, 6);

  return (
    <div className="sc2-planner-page">
      <div className="sc2-page-head">
        <div><span>Planning éditorial</span><h1>Votre semaine, d’un coup d’œil.</h1><p>{accountLabel} · glissez une carte pour la reprogrammer.</p></div>
        <button className="sc2-primary" onClick={() => onCreate()}><Plus size={16} /> Nouvelle publication</button>
      </div>

      <div className="sc2-planner-toolbar">
        <div className="sc2-week-controls">
          <button onClick={() => onWeek(addDays(weekStart, -7))}><ChevronLeft size={17} /></button>
          <button className="sc2-today" onClick={() => onWeek(mondayOf(new Date()))}>Aujourd’hui</button>
          <button onClick={() => onWeek(addDays(weekStart, 7))}><ChevronRight size={17} /></button>
          <strong>{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(weekStart)} — {new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(end)}</strong>
        </div>
        <div className="sc2-view-switch">
          <button className={view === 'week' ? 'active' : ''} onClick={() => onView('week')}><LayoutGrid size={16} /> Semaine</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => onView('list')}><List size={16} /> Liste</button>
        </div>
      </div>

      {loading && <div className="sc2-loading"><LoaderCircle className="sc2-spin" size={18} /> Chargement du planner…</div>}
      {!loading && view === 'week' && (
        <div className="sc2-week-board">
          {days.map((day) => {
            const key = localDateKey(day);
            const items = byDay.get(key) ?? [];
            const today = key === localDateKey(new Date());
            return (
              <section
                key={key}
                className={`sc2-day-column ${today ? 'today' : ''}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event: DragEvent) => { event.preventDefault(); if (dragged) onDrop(dragged, key); }}
              >
                <header><span>{new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(day)}</span><strong>{day.getDate()}</strong><small>{items.length || ''}</small></header>
                <button className="sc2-day-add" onClick={() => onCreate(key)}><Plus size={14} /> Ajouter</button>
                <div className="sc2-day-cards">
                  {items.map((publication) => (
                    <article
                      key={publication.id}
                      className={`sc2-post-card ${draggedPublicationId === publication.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={() => onDragStart(publication.id)}
                      onDragEnd={() => onDragStart(undefined)}
                      onClick={() => onEdit(publication)}
                    >
                      <div className="sc2-post-time"><Clock3 size={13} /> {formatTime(publication.scheduledAt)}</div>
                      <p>{publication.body}</p>
                      <footer><span>{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={13} />)}</span><small>{publication.status}</small></footer>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!loading && view === 'list' && (
        <div className="sc2-planner-list">
          {publications.map((publication) => (
            <button key={publication.id} onClick={() => onEdit(publication)}>
              <time>{new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(publication.scheduledAt))}</time>
              <span><strong>{publication.body}</strong><small>{publication.targets.map((target) => target.displayName).join(' · ')}</small></span>
              <span className="sc2-target-marks">{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} />)}</span>
              <ChevronRight size={16} />
            </button>
          ))}
          {publications.length === 0 && <div className="sc2-empty"><CalendarDays size={25} /><strong>Aucune publication cette période</strong><button onClick={() => onCreate()}>Créer une publication</button></div>}
        </div>
      )}
    </div>
  );
}

function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, onQuery, onFilter, onSelect, onReply, onSend, onSuggest }: {
  conversations: LiveConversation[];
  selected?: LiveConversation;
  messages?: MessagesPayload;
  loading: boolean;
  query: string;
  filter: InboxFilter;
  reply: string;
  outboundReady: boolean;
  aiReady: boolean;
  onQuery: (value: string) => void;
  onFilter: (value: InboxFilter) => void;
  onSelect: (id: string) => void;
  onReply: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onSuggest: () => void;
}) {
  return (
    <div className="sc2-inbox">
      <section className="sc2-conversations">
        <div className="sc2-inbox-title"><span>Inbox unifiée</span><h1>À qui répondre ?</h1></div>
        <label className="sc2-search"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Rechercher…" /></label>
        <div className="sc2-filters">
          {([['all', 'Tout'], ['messages', 'Messages'], ['comments', 'Commentaires']] as Array<[InboxFilter, string]>).map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => onFilter(id)}>{label}</button>)}
        </div>
        <div className="sc2-conversation-list">
          {conversations.map((conversation) => (
            <button key={conversation.id} className={selected?.id === conversation.id ? 'active' : ''} onClick={() => onSelect(conversation.id)}>
              <span className="sc2-avatar">{conversation.contactName.slice(0, 2).toUpperCase()}</span>
              <span><strong>{conversation.contactName}</strong><small>{conversation.latestMessage?.body || 'Conversation ouverte'}</small><em><PlatformMark platform={conversation.platform} size={12} /> {conversation.accountName}</em></span>
              <time>{formatShortDate(conversation.latestMessage?.sentAt)}</time>
            </button>
          ))}
          {!conversations.length && <div className="sc2-empty compact"><Search size={22} /><strong>Aucune conversation</strong></div>}
        </div>
      </section>
      <section className="sc2-thread">
        {selected ? <>
          <header><div><span className="sc2-avatar">{selected.contactName.slice(0, 2).toUpperCase()}</span><span><strong>{selected.contactName}</strong><small>{selected.handle || selected.accountName}</small></span></div><b>{selected.leadStage}</b></header>
          <div className="sc2-messages">
            {loading && <div className="sc2-loading"><LoaderCircle className="sc2-spin" size={17} /> Chargement…</div>}
            {messages && [...messages.messages].reverse().map((message) => <div key={message.id} className={`sc2-message ${message.direction}`}><p>{message.body}</p><small>{formatShortDate(message.sentAt)}</small></div>)}
          </div>
          <div className="sc2-reply">
            <button onClick={onSuggest} disabled={!aiReady}><Sparkles size={15} /> Réponse IA</button>
            <form onSubmit={onSend}><textarea value={reply} onChange={(event) => onReply(event.target.value)} disabled={!outboundReady} placeholder={outboundReady ? 'Écrire une réponse…' : 'Envoi réel encore verrouillé'} /><button type="submit" disabled={!outboundReady || !reply.trim()}><Send size={17} /></button></form>
          </div>
        </> : <div className="sc2-empty"><MessageCircle size={26} /><strong>Choisissez une conversation</strong></div>}
      </section>
    </div>
  );
}

function CreatePage({ body, connections, selectedIds, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule }: {
  body: string;
  connections: LiveConnection[];
  selectedIds: string[];
  scheduleDate: string;
  scheduleTime: string;
  publishNow: boolean;
  customize: boolean;
  accountBodies: Record<string, string>;
  busy: boolean;
  deliveryReady: boolean;
  onBody: (value: string) => void;
  onToggle: (id: string) => void;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  onNow: (value: boolean) => void;
  onCustomize: (value: boolean) => void;
  onAccountBody: (id: string, value: string) => void;
  onSchedule: () => void;
}) {
  const selectedConnections = connections.filter((connection) => selectedIds.includes(connection.id));
  return (
    <div className="sc2-create-page">
      <div className="sc2-page-head"><div><span>Composer</span><h1>Une idée. Plusieurs réseaux.</h1><p>Écrivez une base, puis adaptez uniquement si nécessaire.</p></div></div>
      {!deliveryReady && <div className="sc2-notice"><AlertTriangle size={16} /><span><strong>Planner réel actif.</strong><small>La diffusion automatique externe sera activée réseau par réseau après validation API.</small></span></div>}
      <section className="sc2-compose-card">
        <div className="sc2-compose-main">
          <label><span>Publication de base</span><textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder="Qu’est-ce que vous voulez publier ?" maxLength={5000} /></label>
          <div className="sc2-selected-accounts"><strong>Publier sur</strong><div>{connections.map((connection) => <button key={connection.id} className={selectedIds.includes(connection.id) ? 'active' : ''} onClick={() => onToggle(connection.id)}><PlatformMark platform={connection.platform} /><span>{connection.displayName}</span>{selectedIds.includes(connection.id) && <Check size={13} />}</button>)}</div></div>
          {selectedIds.length > 1 && <label className="sc2-customize-toggle"><input type="checkbox" checked={customize} onChange={(event) => onCustomize(event.target.checked)} /><span><strong>Personnaliser par compte</strong><small>Comme Buffer/Later : chaque variante sera indépendante après programmation.</small></span></label>}
          {customize && selectedConnections.map((connection) => <label className="sc2-variant" key={connection.id}><span><PlatformMark platform={connection.platform} /> {connection.displayName}</span><textarea value={accountBodies[connection.id] ?? body} onChange={(event) => onAccountBody(connection.id, event.target.value)} /></label>)}
        </div>
        <aside className="sc2-schedule-box">
          <h3>Quand publier ?</h3>
          <button className={publishNow ? 'active' : ''} onClick={() => onNow(true)}><Zap size={17} /><span><strong>Maintenant</strong><small>Ajouter à la file immédiate</small></span></button>
          <button className={!publishNow ? 'active' : ''} onClick={() => onNow(false)}><CalendarDays size={17} /><span><strong>Programmer</strong><small>Choisir date et heure</small></span></button>
          {!publishNow && <div className="sc2-date-fields"><label>Date<input type="date" min={localDateKey(new Date())} value={scheduleDate} onChange={(event) => onDate(event.target.value)} /></label><label>Heure<input type="time" value={scheduleTime} onChange={(event) => onTime(event.target.value)} /></label></div>}
          <div className="sc2-compose-summary"><span>{selectedIds.length} compte{selectedIds.length > 1 ? 's' : ''}</span><span>{body.length}/5000</span></div>
          <button className="sc2-primary wide" disabled={busy || !body.trim() || !selectedIds.length} onClick={onSchedule}>{busy ? 'Enregistrement…' : publishNow ? 'Publier / mettre en file' : 'Programmer'} <ChevronRight size={16} /></button>
        </aside>
      </section>
    </div>
  );
}

function ResultsPage({ bootstrap, activeAccountId }: { bootstrap: LiveBootstrap; activeAccountId: ActiveAccount }) {
  const connections = activeAccountId === 'all' ? bootstrap.connections : bootstrap.connections.filter((connection) => connection.id === activeAccountId);
  return (
    <div className="sc2-results">
      <div className="sc2-page-head"><div><span>Performance</span><h1>Les chiffres utiles, sans bruit.</h1><p>Les métriques éditoriales apparaîtront au fur et à mesure des connecteurs actifs.</p></div></div>
      <div className="sc2-metrics"><article><span>Comptes actifs</span><strong>{connections.filter((connection) => connection.status === 'connected').length}</strong></article><article><span>Conversations ouvertes</span><strong>{bootstrap.metrics.openConversations}</strong></article><article><span>Contacts</span><strong>{bootstrap.metrics.contacts}</strong></article><article><span>Pipeline estimé</span><strong>{(bootstrap.metrics.estimatedPipelineCents / 100).toLocaleString('fr-FR')} €</strong></article></div>
      <section className="sc2-channel-table"><header><strong>Comptes</strong><small>État des connexions sociales</small></header>{connections.map((connection) => <div key={connection.id}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span><b className={connection.status === 'connected' ? 'ok' : ''}>{connection.status}</b><time>{formatShortDate(connection.lastSyncedAt)}</time></div>)}</section>
    </div>
  );
}

function SettingsPage({ session, connections, runtime, onConnectInstagram, onRefresh }: {
  session: SessionPayload;
  connections: LiveConnection[];
  runtime: LiveRuntimeStateV2;
  onConnectInstagram: (id?: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="sc2-settings-page">
      <div className="sc2-page-head"><div><span>Réglages</span><h1>Connexions & accès.</h1><p>Le quotidien reste dans le Planner et l’Inbox.</p></div><button className="sc2-secondary" onClick={onRefresh}><RefreshCw size={15} /> Resynchroniser</button></div>
      <div className="sc2-settings-grid">
        <section><h3>Comptes sociaux</h3>{connections.map((connection) => <div className="sc2-setting-account" key={connection.id}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || 'Identifiant non renseigné'}</small></span><b>{connection.status}</b>{connection.platform === 'instagram' && connection.status !== 'connected' && <button onClick={() => onConnectInstagram(connection.id)}>Reconnecter</button>}</div>)}<button className="sc2-connect-row" onClick={() => onConnectInstagram()} disabled={!runtime.instagramOAuthReady}><Plus size={16} /> Connecter Instagram</button></section>
        <section><h3>Votre accès</h3><p>{session.email || session.subject}</p><p>Rôle : <strong>{session.workspace.role}</strong></p><p>Espace : <strong>{session.workspace.name}</strong></p></section>
      </div>
    </div>
  );
}

function AccountPanel({ connections, instagramReady, onClose, onConnectInstagram, onSwitch }: {
  connections: LiveConnection[];
  instagramReady: boolean;
  onClose: () => void;
  onConnectInstagram: (id?: string) => void;
  onSwitch: (id: ActiveAccount) => void;
}) {
  return (
    <div className="sc2-modal-backdrop" onMouseDown={onClose}>
      <section className="sc2-account-panel" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>Comptes sociaux</span><h2>Changer ou connecter</h2></div><button onClick={onClose}><X size={18} /></button></header>
        <button className="sc2-panel-all" onClick={() => onSwitch('all')}><span className="sc2-all-mark">∞</span><span><strong>Tous les comptes</strong><small>Vue globale</small></span><ChevronRight size={16} /></button>
        <div className="sc2-panel-list">{connections.map((connection) => <button key={connection.id} onClick={() => onSwitch(connection.id)}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span><b className={connection.status === 'connected' ? 'ok' : ''}>{connection.status}</b></button>)}</div>
        <div className="sc2-connect-options"><button onClick={() => onConnectInstagram()} disabled={!instagramReady}><PlatformMark platform="instagram" /><span><strong>Ajouter Instagram</strong><small>{instagramReady ? 'Connexion sécurisée OAuth' : 'Configuration serveur requise'}</small></span><Plus size={16} /></button><button disabled><PlatformMark platform="youtube" /><span><strong>Ajouter YouTube</strong><small>Connecteur à activer</small></span></button><button disabled><PlatformMark platform="tiktok" /><span><strong>Ajouter TikTok</strong><small>Connecteur à activer</small></span></button></div>
      </section>
    </div>
  );
}
