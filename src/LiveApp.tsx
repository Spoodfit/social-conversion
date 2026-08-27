import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { ApiError, apiRequest } from './api/client';
import './live-app.css';

export interface LiveRuntimeState {
  mode: 'live';
  ready: boolean;
  outboundReady: boolean;
  aiReady: boolean;
}

type WorkspaceRole = 'admin' | 'manager' | 'agent' | 'viewer';
type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';
type LeadStage = 'Nouveau' | 'Qualifié' | 'Rendez-vous' | 'Proposition' | 'Gagné' | 'Perdu';

const leadStages: LeadStage[] = ['Nouveau', 'Qualifié', 'Rendez-vous', 'Proposition', 'Gagné', 'Perdu'];

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
  status: string;
  priority: string;
  leadStage: string;
  estimatedValueCents: number;
  lastMessageAt?: string;
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

interface InboxConversation extends LiveConversation {
  accountName: string;
  intent?: string;
  sentiment?: string;
  assignedTo?: string;
  updatedAt: string;
  latestMessage?: {
    body: string;
    direction: 'inbound' | 'outbound' | null;
    type: string;
    sentAt: string;
  };
}

interface PageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
}

interface InboxPayload {
  conversations: InboxConversation[];
  page: PageInfo;
}

interface ConversationMessage {
  id: string;
  externalId?: string;
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

interface CrmPatchPayload {
  conversation: {
    id: string;
    leadStage: string;
    estimatedValueCents: number;
    priority: string;
    assignedTo?: string;
    updatedAt: string;
  };
}

function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'WORKSPACE_FORBIDDEN') return 'Vous n’avez pas accès à cet espace.';
    if (error.code === 'LIVE_NOT_READY') return 'L’environnement live est encore verrouillé.';
    if (error.code === 'CONVERSATION_CONFLICT') return 'Cette conversation a été modifiée ailleurs. Les données ont été rechargées.';
    return error.message;
  }
  return 'Une erreur inattendue empêche le chargement.';
}

function platformLabel(platform: SocialPlatform) {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  return 'TikTok';
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

export default function LiveApp({ runtime }: { runtime: LiveRuntimeState }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [session, setSession] = useState<SessionPayload>();
  const [bootstrap, setBootstrap] = useState<LiveBootstrap>();
  const [inbox, setInbox] = useState<InboxPayload>();
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [dataError, setDataError] = useState<string>();
  const [inboxError, setInboxError] = useState<string>();
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string>();
  const [messages, setMessages] = useState<MessagesPayload>();
  const [messagesError, setMessagesError] = useState<string>();
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesLoadingMore, setMessagesLoadingMore] = useState(false);
  const [crmBusy, setCrmBusy] = useState(false);
  const [crmError, setCrmError] = useState<string>();

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
    if (!workspaceId) return undefined;
    let active = true;
    setSession(undefined);
    setBootstrap(undefined);
    setInbox(undefined);
    setDataError(undefined);
    setInboxError(undefined);
    setSelectedConversationId(undefined);
    setMessages(undefined);
    window.localStorage.setItem('social-conversion.workspace', workspaceId);

    Promise.all([
      apiRequest<SessionPayload>('/api/session', {}, workspaceId),
      apiRequest<LiveBootstrap>('/api/bootstrap', {}, workspaceId),
      apiRequest<InboxPayload>('/api/inbox/conversations?limit=25', {}, workspaceId),
    ])
      .then(([nextSession, nextBootstrap, nextInbox]) => {
        if (!active) return;
        setSession(nextSession);
        setBootstrap(nextBootstrap);
        setInbox(nextInbox);
      })
      .catch((error) => active && setDataError(readableError(error)));

    return () => { active = false; };
  }, [workspaceId, refreshIndex]);

  useEffect(() => {
    if (!workspaceId || !selectedConversationId) {
      setMessages(undefined);
      setMessagesError(undefined);
      return undefined;
    }
    let active = true;
    setMessages(undefined);
    setMessagesError(undefined);
    setMessagesLoading(true);
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

  async function loadMoreInbox() {
    if (!workspaceId || !inbox?.page.hasMore || !inbox.page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setInboxError(undefined);
    try {
      const next = await apiRequest<InboxPayload>(
        `/api/inbox/conversations?limit=${inbox.page.limit}&cursor=${encodeURIComponent(inbox.page.nextCursor)}`,
        {},
        workspaceId,
      );
      setInbox((current) => current ? {
        conversations: [...current.conversations, ...next.conversations],
        page: next.page,
      } : next);
    } catch (error) {
      setInboxError(readableError(error));
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadOlderMessages() {
    if (!workspaceId || !selectedConversationId || !messages?.page.hasMore || !messages.page.nextCursor || messagesLoadingMore) return;
    setMessagesLoadingMore(true);
    setMessagesError(undefined);
    try {
      const next = await apiRequest<MessagesPayload>(
        `/api/inbox/conversations/${encodeURIComponent(selectedConversationId)}/messages?limit=${messages.page.limit}&cursor=${encodeURIComponent(messages.page.nextCursor)}`,
        {},
        workspaceId,
      );
      setMessages((current) => current ? {
        conversationId: current.conversationId,
        messages: [...current.messages, ...next.messages],
        page: next.page,
      } : next);
    } catch (error) {
      setMessagesError(readableError(error));
    } finally {
      setMessagesLoadingMore(false);
    }
  }

  async function changeStage(nextStage: LeadStage) {
    if (!workspaceId || !selectedConversation || !session || session.workspace.role === 'viewer' || crmBusy) return;
    setCrmBusy(true);
    setCrmError(undefined);
    try {
      const result = await apiRequest<CrmPatchPayload>(
        `/api/crm/conversations/${encodeURIComponent(selectedConversation.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            expectedUpdatedAt: selectedConversation.updatedAt,
            leadStage: nextStage,
          }),
        },
        workspaceId,
      );
      setInbox((current) => current ? {
        ...current,
        conversations: current.conversations.map((conversation) => conversation.id === result.conversation.id
          ? {
            ...conversation,
            leadStage: result.conversation.leadStage,
            estimatedValueCents: result.conversation.estimatedValueCents,
            priority: result.conversation.priority,
            assignedTo: result.conversation.assignedTo,
            updatedAt: result.conversation.updatedAt,
          }
          : conversation),
      } : current);
      const freshBootstrap = await apiRequest<LiveBootstrap>('/api/bootstrap', {}, workspaceId);
      setBootstrap(freshBootstrap);
    } catch (error) {
      setCrmError(readableError(error));
      if (error instanceof ApiError && error.code === 'CONVERSATION_CONFLICT') {
        try {
          const refreshed = await apiRequest<InboxPayload>('/api/inbox/conversations?limit=25', {}, workspaceId);
          setInbox(refreshed);
        } catch {
          // The original concurrency error remains visible. Never hide it with stale local data.
        }
      }
    } finally {
      setCrmBusy(false);
    }
  }

  if (workspaceError) {
    return <LiveState title="Accès impossible" body={workspaceError} danger />;
  }

  if (!workspaces) {
    return <LiveState title="Vérification de votre accès" body="Chargement des espaces autorisés…" loading />;
  }

  if (workspaces.length === 0) {
    return <LiveState title="Aucun espace autorisé" body="Votre identité Cloudflare Access est valide, mais aucun workspace Social Conversion ne vous est attribué." danger />;
  }

  if (!workspaceId) {
    return (
      <main className="live-gate">
        <section className="live-workspace-picker">
          <span className="live-kicker">Social Conversion</span>
          <h1>Choisissez votre espace</h1>
          <p>Les données restent strictement isolées par workspace. Aucun espace n’est sélectionné automatiquement lorsque plusieurs choix sont possibles.</p>
          <div className="live-workspace-list">
            {workspaces.map((workspace) => (
              <button key={workspace.id} onClick={() => setWorkspaceId(workspace.id)}>
                <span><strong>{workspace.name}</strong><small>{workspace.role}</small></span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (dataError) {
    return (
      <LiveState
        title="Données indisponibles"
        body={dataError}
        danger
        action={<button className="live-primary" onClick={() => setRefreshIndex((value) => value + 1)}><RefreshCw size={16} /> Réessayer</button>}
      />
    );
  }

  if (!session || !bootstrap || !inbox) {
    return <LiveState title={`Ouverture de ${selectedWorkspace?.name ?? 'votre espace'}`} body="Chargement des données réelles…" loading />;
  }

  return (
    <div className="live-shell">
      <header className="live-topbar">
        <div>
          <span className="live-kicker">Neptune Social Conversion</span>
          <strong>{session.workspace.name}</strong>
        </div>
        <div className="live-topbar-actions">
          {workspaces.length > 1 && <button className="live-secondary" onClick={() => setWorkspaceId(undefined)}>Changer d’espace</button>}
          <span className="live-user"><CircleUserRound size={17} /> {session.email ?? session.subject}</span>
        </div>
      </header>

      <main className="live-content">
        <section className="live-heading">
          <div>
            <span className="live-kicker">Production</span>
            <h1>Vue d’ensemble</h1>
            <p>Uniquement des données issues du workspace sélectionné. Aucun fallback de démonstration n’est autorisé ici.</p>
          </div>
          <button className="live-secondary" onClick={() => setRefreshIndex((value) => value + 1)}><RefreshCw size={16} /> Actualiser</button>
        </section>

        <section className="live-readiness">
          <div className={runtime.outboundReady ? 'ready' : 'blocked'}>
            {runtime.outboundReady ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span><strong>Envoi social</strong><small>{runtime.outboundReady ? 'Connecteur outbound prêt' : 'Bloqué tant que le connecteur réel n’est pas validé'}</small></span>
          </div>
          <div className={runtime.aiReady ? 'ready' : 'blocked'}>
            {runtime.aiReady ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span><strong>Copilote IA</strong><small>{runtime.aiReady ? 'Fournisseur IA prêt' : 'Aucune suggestion fictive ne sera générée'}</small></span>
          </div>
          <div className="ready">
            <ShieldCheck size={18} />
            <span><strong>Isolation workspace</strong><small>{session.workspace.role} · {session.workspace.id}</small></span>
          </div>
        </section>

        <section className="live-metrics">
          <Metric label="Comptes connectés" value={bootstrap.metrics.connectedAccounts} />
          <Metric label="Conversations ouvertes" value={bootstrap.metrics.openConversations} />
          <Metric label="Contacts" value={bootstrap.metrics.contacts} />
          <Metric label="Pipeline estimé" value={`${(bootstrap.metrics.estimatedPipelineCents / 100).toLocaleString('fr-FR')} €`} />
        </section>

        <section className="live-grid">
          <article className="live-panel">
            <div className="live-panel-heading"><div><span className="live-kicker">Connexions</span><h2>Comptes sociaux</h2></div><UsersRound size={19} /></div>
            {bootstrap.connections.length ? (
              <div className="live-list">
                {bootstrap.connections.map((connection) => (
                  <div key={connection.id} className="live-list-row">
                    <span><strong>{connection.displayName}</strong><small>{connection.handle || 'Identifiant non renseigné'}</small></span>
                    <span className={`live-status ${connection.status === 'connected' ? 'ok' : ''}`}>{platformLabel(connection.platform)} · {connection.status}</span>
                  </div>
                ))}
              </div>
            ) : <Empty text="Aucun compte social connecté à ce workspace." />}
          </article>

          <article className="live-panel">
            <div className="live-panel-heading"><div><span className="live-kicker">Inbox live</span><h2>Conversations</h2></div><MessageCircle size={19} /></div>
            {inbox.conversations.length ? (
              <>
                <div className="live-list live-conversation-list">
                  {inbox.conversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      className={`live-conversation-row ${conversation.id === selectedConversationId ? 'active' : ''}`}
                      onClick={() => setSelectedConversationId(conversation.id)}
                    >
                      <span className="live-conversation-main">
                        <strong>{conversation.contactName}</strong>
                        <small>{conversation.latestMessage?.body || 'Aucun message'}</small>
                      </span>
                      <span className="live-conversation-meta">
                        <strong>{conversation.leadStage}</strong>
                        <small>{platformLabel(conversation.platform)} · {shortDate(conversation.latestMessage?.sentAt ?? conversation.lastMessageAt)}</small>
                      </span>
                    </button>
                  ))}
                </div>
                {inboxError && <div className="live-inline-error">{inboxError}</div>}
                {inbox.page.hasMore && (
                  <div className="live-panel-footer">
                    <button className="live-secondary" disabled={loadingMore} onClick={loadMoreInbox}>
                      {loadingMore ? <LoaderCircle className="live-spin" size={15} /> : null}
                      Charger plus
                    </button>
                  </div>
                )}
              </>
            ) : <Empty text="Aucune conversation réelle n’a encore été reçue." />}
          </article>
        </section>

        {selectedConversation && (
          <section className="live-conversation-detail">
            <article className="live-panel">
              <div className="live-panel-heading live-detail-heading">
                <div>
                  <span className="live-kicker">Conversation</span>
                  <h2>{selectedConversation.contactName}</h2>
                  <small>{selectedConversation.handle || 'Sans handle'} · {platformLabel(selectedConversation.platform)} · {selectedConversation.accountName}</small>
                </div>
                <label className="live-stage-control">
                  <span>Étape CRM</span>
                  <select
                    value={selectedConversation.leadStage}
                    disabled={crmBusy || session.workspace.role === 'viewer'}
                    onChange={(event) => void changeStage(event.target.value as LeadStage)}
                  >
                    {leadStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                  </select>
                </label>
              </div>

              <div className="live-conversation-summary">
                <span><small>Valeur estimée</small><strong>{(selectedConversation.estimatedValueCents / 100).toLocaleString('fr-FR')} €</strong></span>
                <span><small>Priorité</small><strong>{selectedConversation.priority}</strong></span>
                <span><small>Intention</small><strong>{selectedConversation.intent || 'Non qualifiée'}</strong></span>
                <span><small>Dernière activité</small><strong>{shortDate(selectedConversation.lastMessageAt)}</strong></span>
              </div>

              {crmError && <div className="live-inline-error">{crmError}</div>}

              <div className="live-messages">
                {messagesLoading && <div className="live-empty"><LoaderCircle className="live-spin" size={18} /> Chargement de l’historique…</div>}
                {messagesError && <div className="live-inline-error">{messagesError}</div>}
                {messages?.page.hasMore && (
                  <button className="live-older-button" disabled={messagesLoadingMore} onClick={loadOlderMessages}>
                    {messagesLoadingMore ? 'Chargement…' : 'Afficher les messages plus anciens'}
                  </button>
                )}
                {messages && [...messages.messages].reverse().map((message) => (
                  <div key={message.id} className={`live-message ${message.direction}`}>
                    <div>{message.body}</div>
                    <small>{message.direction === 'outbound' ? 'Neptune' : selectedConversation.contactName} · {shortDate(message.sentAt)}{message.aiAssisted ? ' · assisté IA' : ''}</small>
                  </div>
                ))}
                {messages && messages.messages.length === 0 && <Empty text="Aucun message dans cette conversation." />}
              </div>

              {!runtime.outboundReady && (
                <div className="live-outbound-lock">
                  <ShieldCheck size={17} />
                  <span><strong>Réponse désactivée</strong><small>Le champ d’envoi apparaîtra uniquement après validation du connecteur social réel.</small></span>
                </div>
              )}
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function Empty({ text }: { text: string }) {
  return <div className="live-empty">{text}</div>;
}

function LiveState({ title, body, danger = false, loading = false, action }: { title: string; body: string; danger?: boolean; loading?: boolean; action?: React.ReactNode }) {
  return (
    <main className="live-gate">
      <section className={`live-state ${danger ? 'danger' : ''}`}>
        {loading ? <LoaderCircle className="live-spin" size={24} /> : danger ? <AlertTriangle size={24} /> : <ShieldCheck size={24} />}
        <h1>{title}</h1>
        <p>{body}</p>
        {action}
      </section>
    </main>
  );
}
