import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleUserRound, LoaderCircle, MessageCircle, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react';
import { ApiError, apiRequest } from './api/client';
import './live-app.css';

export interface LiveRuntimeState {
  mode: 'live';
  ready: boolean;
  outboundReady: boolean;
  aiReady: boolean;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  role: 'admin' | 'manager' | 'agent' | 'viewer';
  status: 'invited' | 'active';
}

interface SessionPayload {
  subject: string;
  email?: string;
  workspace: {
    id: string;
    name: string;
    role: WorkspaceSummary['role'];
  };
}

interface LiveConnection {
  id: string;
  platform: 'instagram' | 'youtube' | 'tiktok';
  displayName: string;
  handle?: string;
  status: string;
  lastSyncedAt?: string;
}

interface LiveConversation {
  id: string;
  contactName: string;
  handle?: string;
  platform: 'instagram' | 'youtube' | 'tiktok';
  status: string;
  priority: string;
  leadStage: string;
  estimatedValueCents: number;
  lastMessageAt?: string;
}

interface LiveBootstrap {
  workspace: { id: string; name: string; role: WorkspaceSummary['role'] };
  metrics: {
    contacts: number;
    openConversations: number;
    connectedAccounts: number;
    estimatedPipelineCents: number;
  };
  connections: LiveConnection[];
  recentConversations: LiveConversation[];
}

function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'WORKSPACE_FORBIDDEN') return 'Vous n’avez pas accès à cet espace.';
    if (error.code === 'LIVE_NOT_READY') return 'L’environnement live est encore verrouillé.';
    return error.message;
  }
  return 'Une erreur inattendue empêche le chargement.';
}

function platformLabel(platform: LiveConnection['platform']) {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  return 'TikTok';
}

export default function LiveApp({ runtime }: { runtime: LiveRuntimeState }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [session, setSession] = useState<SessionPayload>();
  const [bootstrap, setBootstrap] = useState<LiveBootstrap>();
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [dataError, setDataError] = useState<string>();
  const [refreshIndex, setRefreshIndex] = useState(0);

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
    setDataError(undefined);
    window.localStorage.setItem('social-conversion.workspace', workspaceId);

    Promise.all([
      apiRequest<SessionPayload>('/api/session', {}, workspaceId),
      apiRequest<LiveBootstrap>('/api/bootstrap', {}, workspaceId),
    ])
      .then(([nextSession, nextBootstrap]) => {
        if (!active) return;
        setSession(nextSession);
        setBootstrap(nextBootstrap);
      })
      .catch((error) => active && setDataError(readableError(error)));

    return () => { active = false; };
  }, [workspaceId, refreshIndex]);

  const selectedWorkspace = useMemo(
    () => workspaces?.find((workspace) => workspace.id === workspaceId),
    [workspaces, workspaceId],
  );

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

  if (!session || !bootstrap) {
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
            <div className="live-panel-heading"><div><span className="live-kicker">Inbox</span><h2>Conversations récentes</h2></div><MessageCircle size={19} /></div>
            {bootstrap.recentConversations.length ? (
              <div className="live-list">
                {bootstrap.recentConversations.map((conversation) => (
                  <div key={conversation.id} className="live-list-row">
                    <span><strong>{conversation.contactName}</strong><small>{platformLabel(conversation.platform)} · {conversation.leadStage}</small></span>
                    <span>{(conversation.estimatedValueCents / 100).toLocaleString('fr-FR')} €</span>
                  </div>
                ))}
              </div>
            ) : <Empty text="Aucune conversation réelle n’a encore été reçue." />}
          </article>
        </section>
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
