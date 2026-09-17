import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Inbox as InboxIcon,
  LayoutGrid,
  List,
  LoaderCircle,
  MessageCircle,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { ApiError, apiRequest } from './api/client';

export interface LiveRuntimeStateV3 {
  mode: 'live';
  ready: boolean;
  outboundReady: boolean;
  aiReady: boolean;
  instagramOAuthReady?: boolean;
  publishingSchedulerReady?: boolean;
  contentPublishingReady?: boolean;
  mediaLibraryReady?: boolean;
}

type WorkspaceRole = 'admin' | 'manager' | 'agent' | 'viewer';
type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';
type Page = 'planner' | 'inbox' | 'library' | 'create' | 'settings';
type InboxFilter = 'all' | 'messages' | 'comments';
type PlannerView = 'week' | 'list';
type ActiveAccount = 'all' | string;
type MediaFormat = 'post' | 'short' | 'video' | 'story';

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

type MediaItem = {
  id: string;
  fileName: string;
  mimeType: string;
  format: MediaFormat;
  title: string;
  caption: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  previewUrl: string;
};

type UploadDraft = {
  file: File;
  format: MediaFormat;
  title: string;
  caption: string;
  returnTo: 'library' | 'create';
};

type AiDraftPayload = { draft: { id: string; body: string } };

const nav: Array<{ id: 'planner' | 'inbox' | 'library'; label: string; icon: LucideIcon }> = [
  { id: 'planner', label: 'Planner', icon: CalendarDays },
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'library', label: 'Bibliothèque', icon: FolderOpen },
];

const mediaFormatLabels: Record<MediaFormat, string> = {
  post: 'Post',
  short: 'Short / Reel',
  video: 'Vidéo',
  story: 'Story',
};

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
  return <span className={`sc3-platform sc3-${platform}`}>{icon}</span>;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} Ko`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} Mo`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} Go`;
}

function mediaIdFromReference(value?: string) {
  return value?.startsWith('library:') ? value.slice('library:'.length) : undefined;
}

function readableError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'OUTBOUND_NOT_READY') return 'L’envoi réel n’est pas disponible pour ce compte.';
    if (error.code === 'OAUTH_NOT_CONFIGURED') return 'La connexion Instagram doit encore être configurée côté serveur.';
    if (error.code === 'PUBLICATION_CONFLICT') return 'Cette publication a changé ailleurs. Le Planner a été rechargé.';
    if (error.code === 'MEDIA_IN_USE') return 'Ce média est utilisé par une publication programmée.';
    return error.message;
  }
  return 'Une erreur inattendue empêche cette action.';
}

function Gate({ title, body, loading = false }: { title: string; body: string; loading?: boolean }) {
  return (
    <main className="sc3-gate">
      <section>
        {loading ? <LoaderCircle className="sc3-spin" size={24} /> : <AlertTriangle size={24} />}
        <h1>{title}</h1>
        <p>{body}</p>
      </section>
    </main>
  );
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="sc3-toast" role="status">
      <span><Check size={14} /></span>
      <strong>{text}</strong>
      <button onClick={onClose} aria-label="Fermer"><X size={15} /></button>
    </div>
  );
}

export default function LiveAppV3({ runtime }: { runtime: LiveRuntimeStateV3 }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [session, setSession] = useState<SessionPayload>();
  const [bootstrap, setBootstrap] = useState<LiveBootstrap>();
  const [inbox, setInbox] = useState<InboxPayload>();
  const [publications, setPublications] = useState<Publication[]>([]);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const [dataError, setDataError] = useState<string>();
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [loadingPublications, setLoadingPublications] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

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
  const [selectedMediaId, setSelectedMediaId] = useState<string>();
  const [scheduleDate, setScheduleDate] = useState(tomorrowKey());
  const [scheduleTime, setScheduleTime] = useState('10:00');
  const [publishNow, setPublishNow] = useState(false);
  const [customizePerAccount, setCustomizePerAccount] = useState(false);
  const [accountBodies, setAccountBodies] = useState<Record<string, string>>({});
  const [publishBusy, setPublishBusy] = useState(false);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadReturnToRef = useRef<'library' | 'create'>('library');
  const [uploadDraft, setUploadDraft] = useState<UploadDraft>();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editingMedia, setEditingMedia] = useState<MediaItem>();

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
        const connected = nextBootstrap.connections.filter((connection) => connection.status === 'connected');
        setSelectedConnectionIds((current) => {
          const valid = current.filter((id) => connected.some((connection) => connection.id === id));
          return valid.length ? valid : connected[0] ? [connected[0].id] : [];
        });
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
    apiRequest<{ publications: Publication[] }>('/api/publications', {}, workspaceId)
      .then((payload) => active && setPublications(payload.publications))
      .catch((error) => active && setToast(readableError(error)))
      .finally(() => active && setLoadingPublications(false));
    return () => { active = false; };
  }, [workspaceId, runtime.publishingSchedulerReady, refreshIndex]);

  useEffect(() => {
    if (!workspaceId || !runtime.mediaLibraryReady) return undefined;
    let active = true;
    setLoadingLibrary(true);
    apiRequest<{ items: MediaItem[] }>('/api/library', {}, workspaceId)
      .then((payload) => active && setLibrary(payload.items))
      .catch((error) => active && setToast(readableError(error)))
      .finally(() => active && setLoadingLibrary(false));
    return () => { active = false; };
  }, [workspaceId, runtime.mediaLibraryReady, refreshIndex]);

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
  const mediaById = useMemo(() => new Map(library.map((item) => [item.id, item])), [library]);

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

  useEffect(() => {
    if (!visibleConversations.length) {
      setSelectedConversationId(undefined);
      return;
    }
    if (!visibleConversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(visibleConversations[0]?.id);
    }
  }, [visibleConversations, selectedConversationId]);

  const selectedConversation = useMemo(
    () => inbox?.conversations.find((conversation) => conversation.id === selectedConversationId),
    [inbox, selectedConversationId],
  );
  const selectedMedia = selectedMediaId ? mediaById.get(selectedMediaId) : undefined;

  function navigate(next: Page) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchAccount(id: ActiveAccount) {
    setActiveAccountId(id);
    if (id !== 'all' && page === 'create') setSelectedConnectionIds([id]);
    setAccountPanelOpen(false);
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
      setToast('Réponse envoyée.');
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

  function openCreate(dateKey?: string, minutes?: number) {
    if (dateKey) setScheduleDate(dateKey);
    if (minutes !== undefined) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      setScheduleTime(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);
    }
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
    setSelectedMediaId(undefined);
    setSelectedConnectionIds(activeAccountId !== 'all'
      ? [activeAccountId]
      : connectedConnections[0] ? [connectedConnections[0].id] : []);
  }

  async function schedulePublication() {
    if (!workspaceId || publishBusy) return;
    if (!runtime.publishingSchedulerReady) {
      setToast('Le Planner n’est pas disponible.');
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

    const scheduledAt = publishNow && runtime.contentPublishingReady
      ? new Date(Date.now() + 30_000).toISOString()
      : new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
    if (new Date(scheduledAt).getTime() < Date.now() - 30_000) {
      setToast('Choisissez une date et une heure futures.');
      return;
    }

    setPublishBusy(true);
    try {
      const mediaReference = selectedMediaId ? `library:${selectedMediaId}` : undefined;
      const created: Publication[] = [];
      if (customizePerAccount && selectedConnectionIds.length > 1) {
        for (const connectionId of selectedConnectionIds) {
          const result = await apiRequest<{ publication: Publication }>('/api/publications', {
            method: 'POST',
            body: JSON.stringify({
              body: (accountBodies[connectionId] ?? body).trim() || body,
              mediaReference,
              scheduledAt,
              connectionIds: [connectionId],
            }),
          }, workspaceId);
          created.push(result.publication);
        }
      } else {
        const result = await apiRequest<{ publication: Publication }>('/api/publications', {
          method: 'POST',
          body: JSON.stringify({ body, mediaReference, scheduledAt, connectionIds: selectedConnectionIds }),
        }, workspaceId);
        created.push(result.publication);
      }
      setPublications((current) => [...current, ...created]);
      resetComposer();
      navigate('planner');
      setToast(runtime.contentPublishingReady ? 'Publication programmée.' : 'Publication ajoutée au Planner.');
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
      setSelectedMediaId(mediaIdFromReference(publication.mediaReference));
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

  async function movePublication(publication: Publication, targetDateKey: string, minutes: number) {
    if (!workspaceId || rescheduleBusy) return;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const next = new Date(`${targetDateKey}T${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`);
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
      setToast(`Reprogrammée le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(next)}.`);
    } catch (error) {
      setToast(readableError(error));
      setRefreshIndex((value) => value + 1);
    } finally {
      setRescheduleBusy(false);
      setDraggedPublicationId(undefined);
    }
  }

  function requestUpload(returnTo: 'library' | 'create') {
    uploadReturnToRef.current = returnTo;
    uploadInputRef.current?.click();
  }

  function pickUploadFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setToast('Choisissez une image ou une vidéo.');
      return;
    }
    setUploadDraft({
      file,
      format: file.type.startsWith('video/') ? 'short' : 'post',
      title: file.name.replace(/\.[^.]+$/, ''),
      caption: '',
      returnTo: uploadReturnToRef.current,
    });
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  }

  async function performUpload() {
    if (!workspaceId || !uploadDraft || uploadBusy) return;
    setUploadBusy(true);
    setUploadProgress(0);
    let uploadId: string | undefined;
    try {
      const initialized = await apiRequest<{ upload: { id: string; partSize: number } }>('/api/library/uploads', {
        method: 'POST',
        body: JSON.stringify({
          fileName: uploadDraft.file.name,
          mimeType: uploadDraft.file.type || 'application/octet-stream',
          format: uploadDraft.format,
          title: uploadDraft.title,
          caption: uploadDraft.caption,
          sizeBytes: uploadDraft.file.size,
        }),
      }, workspaceId);
      uploadId = initialized.upload.id;
      const parts: Array<{ partNumber: number; etag: string }> = [];
      const partSize = initialized.upload.partSize;
      const totalParts = Math.ceil(uploadDraft.file.size / partSize);
      for (let index = 0; index < totalParts; index += 1) {
        const start = index * partSize;
        const end = Math.min(uploadDraft.file.size, start + partSize);
        const response = await fetch(`/api/library/uploads/${encodeURIComponent(uploadId)}/parts/${index + 1}`, {
          method: 'PUT',
          headers: {
            accept: 'application/json',
            'content-type': 'application/octet-stream',
            'x-workspace-id': workspaceId,
          },
          body: uploadDraft.file.slice(start, end),
        });
        const payload = await response.json().catch(() => undefined) as { part?: { partNumber: number; etag: string }; error?: string } | undefined;
        if (!response.ok || !payload?.part) throw new Error(payload?.error || `Upload interrompu (${response.status}).`);
        parts.push(payload.part);
        setUploadProgress(Math.round(((index + 1) / totalParts) * 90));
      }
      const completed = await apiRequest<{ item: MediaItem }>(`/api/library/uploads/${encodeURIComponent(uploadId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({ parts }),
      }, workspaceId);
      setLibrary((current) => [completed.item, ...current.filter((item) => item.id !== completed.item.id)]);
      setUploadProgress(100);
      const returnTo = uploadDraft.returnTo;
      setUploadDraft(undefined);
      if (returnTo === 'create') {
        setSelectedMediaId(completed.item.id);
        if (!publishBody.trim() && completed.item.caption) setPublishBody(completed.item.caption);
        navigate('create');
      } else {
        navigate('library');
      }
      setToast('Contenu ajouté à la bibliothèque.');
    } catch (error) {
      if (uploadId) {
        await apiRequest(`/api/library/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' }, workspaceId).catch(() => undefined);
      }
      setToast(error instanceof Error ? error.message : readableError(error));
    } finally {
      setUploadBusy(false);
    }
  }

  async function saveMedia(item: MediaItem, values: { title: string; caption: string; format: MediaFormat }) {
    if (!workspaceId) return;
    try {
      const result = await apiRequest<{ item: MediaItem }>(`/api/library/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(values),
      }, workspaceId);
      setLibrary((current) => current.map((candidate) => candidate.id === item.id ? result.item : candidate));
      setEditingMedia(undefined);
      setToast('Contenu mis à jour.');
    } catch (error) {
      setToast(readableError(error));
    }
  }

  async function deleteMedia(item: MediaItem) {
    if (!workspaceId) return;
    if (!window.confirm(`Supprimer « ${item.title} » de la bibliothèque ?`)) return;
    try {
      await apiRequest(`/api/library/${encodeURIComponent(item.id)}`, { method: 'DELETE' }, workspaceId);
      setLibrary((current) => current.filter((candidate) => candidate.id !== item.id));
      if (selectedMediaId === item.id) setSelectedMediaId(undefined);
      setEditingMedia(undefined);
      setToast('Contenu supprimé.');
    } catch (error) {
      setToast(readableError(error));
    }
  }

  function scheduleMedia(item: MediaItem) {
    setSelectedMediaId(item.id);
    if (!publishBody.trim() && item.caption) setPublishBody(item.caption);
    openCreate();
  }

  if (dataError) return <Gate title="Social Conversion indisponible" body={dataError} />;
  if (!workspaces || !workspaceId || !session || !bootstrap || !inbox) {
    return <Gate title="Ouverture de Social Conversion" body="Chargement de votre espace…" loading />;
  }

  return (
    <div className="sc3-shell">
      <input
        ref={uploadInputRef}
        className="sc3-hidden-input"
        type="file"
        accept="image/*,video/*"
        onChange={(event) => pickUploadFile(event.target.files?.[0])}
      />

      <aside className="sc3-sidebar">
        <button className="sc3-brand" onClick={() => navigate('planner')}>
          <span>N</span><strong>Social<small>Conversion</small></strong>
        </button>
        <nav>
          {nav.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sc3-side-bottom">
          <button className={page === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><Settings2 size={18} /><span>Réglages</span></button>
        </div>
      </aside>

      <section className="sc3-workspace">
        <header className="sc3-topbar">
          <div className="sc3-title">
            <strong>{page === 'planner' ? 'Planner' : page === 'inbox' ? 'Inbox' : page === 'library' ? 'Bibliothèque' : page === 'create' ? 'Nouvelle publication' : 'Réglages'}</strong>
            <small>{session.workspace.name}</small>
          </div>
          <div className="sc3-top-actions">
            <button className="sc3-account-pill" onClick={() => setAccountPanelOpen(true)}>
              {activeConnection ? <PlatformMark platform={activeConnection.platform} size={14} /> : <span className="sc3-all-mark">∞</span>}
              <span><strong>{activeConnection?.displayName ?? 'Tous les comptes'}</strong><small>{activeConnection?.handle ?? `${connectedConnections.length} connecté${connectedConnections.length > 1 ? 's' : ''}`}</small></span>
              <ChevronDown size={15} />
            </button>
            <button className="sc3-create" onClick={() => openCreate()}><Plus size={16} /> Créer</button>
          </div>
        </header>

        <main className="sc3-content">
          {page === 'planner' && (
            <PlannerPage
              publications={visiblePublications}
              library={mediaById}
              weekStart={weekStart}
              view={plannerView}
              loading={loadingPublications}
              draggedPublicationId={draggedPublicationId}
              onWeek={setWeekStart}
              onView={setPlannerView}
              onCreate={openCreate}
              onEdit={(publication) => void editPublication(publication)}
              onDragStart={setDraggedPublicationId}
              onDrop={(publication, dateKey, minutes) => void movePublication(publication, dateKey, minutes)}
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
              accountLabel={activeConnection?.displayName ?? 'Tous les comptes'}
              onQuery={setQuery}
              onFilter={setInboxFilter}
              onSelect={setSelectedConversationId}
              onReply={setReply}
              onSend={sendReply}
              onSuggest={() => void suggestReply()}
            />
          )}

          {page === 'library' && (
            <LibraryPage
              items={library}
              publications={publications}
              loading={loadingLibrary}
              onUpload={() => requestUpload('library')}
              onSchedule={scheduleMedia}
              onEdit={setEditingMedia}
            />
          )}

          {page === 'create' && (
            <CreatePage
              body={publishBody}
              connections={connectedConnections}
              selectedIds={selectedConnectionIds}
              selectedMedia={selectedMedia}
              library={library}
              scheduleDate={scheduleDate}
              scheduleTime={scheduleTime}
              publishNow={publishNow}
              customize={customizePerAccount}
              accountBodies={accountBodies}
              busy={publishBusy}
              deliveryReady={Boolean(runtime.contentPublishingReady)}
              onBody={setPublishBody}
              onToggle={(id) => setSelectedConnectionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
              onSelectMedia={setSelectedMediaId}
              onUpload={() => requestUpload('create')}
              onOpenLibrary={() => navigate('library')}
              onDate={setScheduleDate}
              onTime={setScheduleTime}
              onNow={setPublishNow}
              onCustomize={setCustomizePerAccount}
              onAccountBody={(id, value) => setAccountBodies((current) => ({ ...current, [id]: value }))}
              onSchedule={() => void schedulePublication()}
            />
          )}

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

      <nav className="sc3-mobile-nav">
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
          onSwitch={switchAccount}
        />
      )}
      {uploadDraft && (
        <UploadDialog
          draft={uploadDraft}
          busy={uploadBusy}
          progress={uploadProgress}
          onChange={setUploadDraft}
          onClose={() => !uploadBusy && setUploadDraft(undefined)}
          onUpload={() => void performUpload()}
        />
      )}
      {editingMedia && (
        <MediaEditDialog
          item={editingMedia}
          onClose={() => setEditingMedia(undefined)}
          onSave={(values) => void saveMedia(editingMedia, values)}
          onDelete={() => void deleteMedia(editingMedia)}
          onSchedule={() => { setEditingMedia(undefined); scheduleMedia(editingMedia); }}
        />
      )}
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
    </div>
  );
}

function PlannerPage({ publications, library, weekStart, view, loading, draggedPublicationId, onWeek, onView, onCreate, onEdit, onDragStart, onDrop, accountLabel }: {
  publications: Publication[];
  library: Map<string, MediaItem>;
  weekStart: Date;
  view: PlannerView;
  loading: boolean;
  draggedPublicationId?: string;
  onWeek: (date: Date) => void;
  onView: (view: PlannerView) => void;
  onCreate: (dateKey?: string, minutes?: number) => void;
  onEdit: (publication: Publication) => void;
  onDragStart: (id?: string) => void;
  onDrop: (publication: Publication, dateKey: string, minutes: number) => void;
  accountLabel: string;
}) {
  const SLOT_HEIGHT = 54;
  const DAY_HEIGHT = SLOT_HEIGHT * 24;
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view !== 'week') return;
    requestAnimationFrame(() => {
      if (scrollRef.current && scrollRef.current.scrollTop < 20) scrollRef.current.scrollTop = SLOT_HEIGHT * 7;
    });
  }, [view, weekStart]);

  return (
    <div className="sc3-planner-page">
      <div className="sc3-page-head compact">
        <div><h1>Planning</h1><p>{accountLabel}</p></div>
        <button className="sc3-primary" onClick={() => onCreate()}><Plus size={16} /> Nouvelle publication</button>
      </div>
      <div className="sc3-planner-toolbar">
        <div className="sc3-week-controls">
          <button onClick={() => onWeek(addDays(weekStart, -7))}><ChevronLeft size={17} /></button>
          <button className="sc3-today" onClick={() => onWeek(mondayOf(new Date()))}>Aujourd’hui</button>
          <button onClick={() => onWeek(addDays(weekStart, 7))}><ChevronRight size={17} /></button>
          <strong>{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(weekStart)} — {new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(end)}</strong>
        </div>
        <div className="sc3-view-switch">
          <button className={view === 'week' ? 'active' : ''} onClick={() => onView('week')}><LayoutGrid size={15} /> Semaine</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => onView('list')}><List size={15} /> Liste</button>
        </div>
      </div>

      {loading && <div className="sc3-loading"><LoaderCircle className="sc3-spin" size={18} /> Chargement du Planner…</div>}
      {!loading && view === 'week' && (
        <div className="sc3-calendar-shell">
          <div className="sc3-calendar-head">
            <div />
            {days.map((day) => {
              const key = localDateKey(day);
              const today = key === localDateKey(new Date());
              return <button key={key} className={today ? 'today' : ''} onClick={() => onCreate(key, 10 * 60)}><span>{new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(day)}</span><strong>{day.getDate()}</strong><small>{(byDay.get(key) ?? []).length || ''}</small></button>;
            })}
          </div>
          <div className="sc3-calendar-scroll" ref={scrollRef}>
            <div className="sc3-calendar-body" style={{ height: DAY_HEIGHT }}>
              <div className="sc3-time-gutter">
                {Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * SLOT_HEIGHT }}>{String(hour).padStart(2, '0')}:00</span>)}
              </div>
              {days.map((day) => {
                const key = localDateKey(day);
                const items = byDay.get(key) ?? [];
                const isToday = key === localDateKey(new Date());
                return (
                  <section
                    key={key}
                    className={`sc3-day-track ${isToday ? 'today' : ''}`}
                    style={{ height: DAY_HEIGHT, backgroundSize: `100% ${SLOT_HEIGHT}px` }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event: DragEvent<HTMLElement>) => {
                      event.preventDefault();
                      if (!dragged) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const y = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top));
                      const rawMinutes = (y / rect.height) * 24 * 60;
                      const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round(rawMinutes / 15) * 15));
                      onDrop(dragged, key, minutes);
                    }}
                    onDoubleClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const y = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top));
                      const rawMinutes = (y / rect.height) * 24 * 60;
                      const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round(rawMinutes / 15) * 15));
                      onCreate(key, minutes);
                    }}
                  >
                    {isToday && (() => {
                      const now = new Date();
                      const top = ((now.getHours() * 60 + now.getMinutes()) / 60) * SLOT_HEIGHT;
                      return <div className="sc3-now-line" style={{ top }}><span /></div>;
                    })()}
                    {items.map((publication, index) => {
                      const date = new Date(publication.scheduledAt);
                      const minutes = date.getHours() * 60 + date.getMinutes();
                      const top = (minutes / 60) * SLOT_HEIGHT;
                      const media = library.get(mediaIdFromReference(publication.mediaReference) ?? '');
                      return (
                        <article
                          key={publication.id}
                          className={`sc3-agenda-card ${draggedPublicationId === publication.id ? 'dragging' : ''}`}
                          style={{ top: top + (index % 2) * 2 }}
                          draggable
                          onDragStart={() => onDragStart(publication.id)}
                          onDragEnd={() => onDragStart(undefined)}
                          onClick={(event) => { event.stopPropagation(); onEdit(publication); }}
                        >
                          {media?.mimeType.startsWith('image/') && <img src={media.previewUrl} alt="" />}
                          <div><time>{formatTime(publication.scheduledAt)}</time><strong>{publication.body}</strong><span>{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={11} />)}</span></div>
                        </article>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!loading && view === 'list' && (
        <div className="sc3-planner-list">
          {publications.map((publication) => {
            const media = library.get(mediaIdFromReference(publication.mediaReference) ?? '');
            return (
              <button key={publication.id} onClick={() => onEdit(publication)}>
                <time>{new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(publication.scheduledAt))}</time>
                <span className="sc3-list-thumb">{media?.mimeType.startsWith('image/') ? <img src={media.previewUrl} alt="" /> : media ? <Video size={17} /> : <MessageCircle size={17} />}</span>
                <span><strong>{publication.body}</strong><small>{publication.targets.map((target) => target.displayName).join(' · ')}</small></span>
                <span className="sc3-target-marks">{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} />)}</span>
                <ChevronRight size={16} />
              </button>
            );
          })}
          {publications.length === 0 && <div className="sc3-empty"><CalendarDays size={25} /><strong>Aucune publication programmée</strong><button onClick={() => onCreate()}>Créer une publication</button></div>}
        </div>
      )}
    </div>
  );
}

function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest }: {
  conversations: LiveConversation[];
  selected?: LiveConversation;
  messages?: MessagesPayload;
  loading: boolean;
  query: string;
  filter: InboxFilter;
  reply: string;
  outboundReady: boolean;
  aiReady: boolean;
  accountLabel: string;
  onQuery: (value: string) => void;
  onFilter: (value: InboxFilter) => void;
  onSelect: (id: string) => void;
  onReply: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onSuggest: () => void;
}) {
  return (
    <div className="sc3-inbox-wrap">
      <div className="sc3-page-head compact"><div><h1>Inbox</h1><p>{accountLabel} · messages et commentaires au même endroit</p></div></div>
      <div className="sc3-inbox">
        <section className="sc3-conversations">
          <label className="sc3-search"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Rechercher une personne…" /></label>
          <div className="sc3-filters">
            {([['all', 'Tout'], ['messages', 'Messages'], ['comments', 'Commentaires']] as Array<[InboxFilter, string]>).map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => onFilter(id)}>{label}</button>)}
          </div>
          <div className="sc3-conversation-list">
            {conversations.map((conversation) => (
              <button key={conversation.id} className={selected?.id === conversation.id ? 'active' : ''} onClick={() => onSelect(conversation.id)}>
                <span className="sc3-avatar">{conversation.contactName.slice(0, 2).toUpperCase()}</span>
                <span><strong>{conversation.contactName}</strong><small>{conversation.latestMessage?.body || 'Conversation ouverte'}</small><em><PlatformMark platform={conversation.platform} size={12} /> {conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}</em></span>
                <time>{formatShortDate(conversation.latestMessage?.sentAt)}</time>
              </button>
            ))}
            {!conversations.length && <div className="sc3-empty compact"><Search size={22} /><strong>Aucune conversation</strong></div>}
          </div>
        </section>
        <section className="sc3-thread">
          {selected ? <>
            <header><div><span className="sc3-avatar">{selected.contactName.slice(0, 2).toUpperCase()}</span><span><strong>{selected.contactName}</strong><small>{selected.handle || selected.accountName}</small></span></div><b>{selected.leadStage}</b></header>
            <div className="sc3-messages">
              {loading && <div className="sc3-loading"><LoaderCircle className="sc3-spin" size={17} /> Chargement…</div>}
              {messages && [...messages.messages].reverse().map((message) => <div key={message.id} className={`sc3-message ${message.direction}`}><p>{message.body}</p><small>{formatShortDate(message.sentAt)}{message.aiAssisted ? ' · IA' : ''}</small></div>)}
            </div>
            <div className="sc3-reply">
              {aiReady && <button onClick={onSuggest}><Sparkles size={15} /> Proposer une réponse</button>}
              <form onSubmit={onSend}><textarea value={reply} onChange={(event) => onReply(event.target.value)} disabled={!outboundReady} placeholder={outboundReady ? 'Écrire une réponse…' : 'Réponse sortante non disponible pour ce compte'} /><button type="submit" disabled={!outboundReady || !reply.trim()}><Send size={17} /></button></form>
            </div>
          </> : <div className="sc3-empty"><MessageCircle size={26} /><strong>Choisissez une conversation</strong></div>}
        </section>
      </div>
    </div>
  );
}

function LibraryPage({ items, publications, loading, onUpload, onSchedule, onEdit }: {
  items: MediaItem[];
  publications: Publication[];
  loading: boolean;
  onUpload: () => void;
  onSchedule: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
}) {
  const [format, setFormat] = useState<'all' | MediaFormat>('all');
  const [search, setSearch] = useState('');
  const usage = useMemo(() => {
    const map = new Map<string, number>();
    publications.forEach((publication) => {
      const id = mediaIdFromReference(publication.mediaReference);
      if (id && publication.status !== 'cancelled') map.set(id, (map.get(id) ?? 0) + 1);
    });
    return map;
  }, [publications]);
  const visible = useMemo(() => items.filter((item) => {
    if (format !== 'all' && item.format !== format) return false;
    const text = `${item.title} ${item.caption} ${item.fileName}`.toLowerCase();
    return text.includes(search.trim().toLowerCase());
  }), [items, format, search]);

  return (
    <div className="sc3-library-page">
      <div className="sc3-page-head compact"><div><h1>Bibliothèque</h1><p>Tout ce qui est prêt à publier, au même endroit.</p></div><button className="sc3-primary" onClick={onUpload}><Upload size={15} /> Importer</button></div>
      <div className="sc3-library-toolbar">
        <label className="sc3-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un contenu…" /></label>
        <div className="sc3-format-tabs">
          {([['all', 'Tout'], ['post', 'Posts'], ['short', 'Shorts'], ['video', 'Vidéos'], ['story', 'Stories']] as Array<['all' | MediaFormat, string]>).map(([id, label]) => <button key={id} className={format === id ? 'active' : ''} onClick={() => setFormat(id)}>{label}</button>)}
        </div>
      </div>
      {loading && <div className="sc3-loading"><LoaderCircle className="sc3-spin" size={18} /> Chargement de la bibliothèque…</div>}
      {!loading && (
        <div className="sc3-library-grid">
          {visible.map((item) => (
            <article key={item.id} className="sc3-media-card">
              <div className="sc3-media-preview">
                {item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt={item.title} loading="lazy" /> : <div><Video size={30} /><span>{mediaFormatLabels[item.format]}</span></div>}
                <span className="sc3-format-badge">{mediaFormatLabels[item.format]}</span>
                {usage.get(item.id) ? <span className="sc3-use-badge">{usage.get(item.id)} programmé{(usage.get(item.id) ?? 0) > 1 ? 's' : ''}</span> : null}
              </div>
              <div className="sc3-media-copy"><strong>{item.title}</strong><small>{item.caption || item.fileName}</small><em>{formatBytes(item.sizeBytes)}</em></div>
              <footer><button onClick={() => onSchedule(item)}><CalendarDays size={14} /> Programmer</button><button onClick={() => onEdit(item)}><Pencil size={14} /> Modifier</button><a href={item.previewUrl} target="_blank" rel="noreferrer" aria-label="Ouvrir"><Eye size={14} /></a></footer>
            </article>
          ))}
          {!visible.length && <div className="sc3-empty library-empty"><FolderOpen size={28} /><strong>{items.length ? 'Aucun contenu avec ces filtres' : 'Votre bibliothèque est vide'}</strong><span>{items.length ? 'Changez le filtre ou la recherche.' : 'Importez vos visuels, shorts et vidéos une seule fois.'}</span>{!items.length && <button onClick={onUpload}>Importer un contenu</button>}</div>}
        </div>
      )}
    </div>
  );
}

function CreatePage({ body, connections, selectedIds, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule }: {
  body: string;
  connections: LiveConnection[];
  selectedIds: string[];
  selectedMedia?: MediaItem;
  library: MediaItem[];
  scheduleDate: string;
  scheduleTime: string;
  publishNow: boolean;
  customize: boolean;
  accountBodies: Record<string, string>;
  busy: boolean;
  deliveryReady: boolean;
  onBody: (value: string) => void;
  onToggle: (id: string) => void;
  onSelectMedia: (id?: string) => void;
  onUpload: () => void;
  onOpenLibrary: () => void;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  onNow: (value: boolean) => void;
  onCustomize: (value: boolean) => void;
  onAccountBody: (id: string, value: string) => void;
  onSchedule: () => void;
}) {
  const selectedConnections = connections.filter((connection) => selectedIds.includes(connection.id));
  return (
    <div className="sc3-create-page">
      <div className="sc3-page-head compact"><div><h1>Nouvelle publication</h1><p>Contenu → comptes → date. Rien de plus.</p></div></div>
      <section className="sc3-compose-card">
        <div className="sc3-compose-main">
          <label className="sc3-caption-field"><span>Texte</span><textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder="Écrivez votre publication…" maxLength={5000} /></label>

          <div className="sc3-media-section">
            <div className="sc3-section-title"><span><strong>Média</strong><small>Optionnel</small></span><div><button onClick={onUpload}><Upload size={14} /> Importer</button><button onClick={onOpenLibrary}><FolderOpen size={14} /> Bibliothèque</button></div></div>
            {selectedMedia ? (
              <div className="sc3-selected-media">
                <div>{selectedMedia.mimeType.startsWith('image/') ? <img src={selectedMedia.previewUrl} alt="" /> : <Video size={24} />}</div>
                <span><strong>{selectedMedia.title}</strong><small>{mediaFormatLabels[selectedMedia.format]} · {formatBytes(selectedMedia.sizeBytes)}</small></span>
                <button onClick={() => onSelectMedia(undefined)}><X size={15} /></button>
              </div>
            ) : (
              <div className="sc3-media-quick">
                {library.slice(0, 6).map((item) => <button key={item.id} onClick={() => { onSelectMedia(item.id); if (!body.trim() && item.caption) onBody(item.caption); }}>{item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt="" /> : <Video size={19} />}<span>{item.title}</span></button>)}
                {!library.length && <button className="empty" onClick={onUpload}><Plus size={18} /><span>Importer le premier média</span></button>}
              </div>
            )}
          </div>

          <div className="sc3-selected-accounts"><strong>Publier sur</strong><div>{connections.map((connection) => <button key={connection.id} className={selectedIds.includes(connection.id) ? 'active' : ''} onClick={() => onToggle(connection.id)}><PlatformMark platform={connection.platform} /><span>{connection.displayName}</span>{selectedIds.includes(connection.id) && <Check size={13} />}</button>)}</div>{!connections.length && <p>Aucun compte social connecté.</p>}</div>
          {selectedIds.length > 1 && <label className="sc3-customize-toggle"><input type="checkbox" checked={customize} onChange={(event) => onCustomize(event.target.checked)} /><span><strong>Adapter le texte par compte</strong><small>À utiliser seulement si les plateformes nécessitent une variante.</small></span></label>}
          {customize && selectedConnections.map((connection) => <label className="sc3-variant" key={connection.id}><span><PlatformMark platform={connection.platform} /> {connection.displayName}</span><textarea value={accountBodies[connection.id] ?? body} onChange={(event) => onAccountBody(connection.id, event.target.value)} /></label>)}
        </div>
        <aside className="sc3-schedule-box">
          <h3>Programmation</h3>
          {deliveryReady && <button className={publishNow ? 'active' : ''} onClick={() => onNow(true)}><Zap size={17} /><span><strong>Maintenant</strong><small>Publier dès que possible</small></span></button>}
          <button className={!publishNow || !deliveryReady ? 'active' : ''} onClick={() => onNow(false)}><CalendarDays size={17} /><span><strong>Programmer</strong><small>Choisir date et heure</small></span></button>
          {(!publishNow || !deliveryReady) && <div className="sc3-date-fields"><label>Date<input type="date" min={localDateKey(new Date())} value={scheduleDate} onChange={(event) => onDate(event.target.value)} /></label><label>Heure<input type="time" value={scheduleTime} onChange={(event) => onTime(event.target.value)} /></label></div>}
          <div className="sc3-compose-summary"><span>{selectedIds.length} compte{selectedIds.length > 1 ? 's' : ''}</span><span>{selectedMedia ? '1 média' : 'Sans média'}</span><span>{body.length}/5000</span></div>
          <button className="sc3-primary wide" disabled={busy || !body.trim() || !selectedIds.length} onClick={onSchedule}>{busy ? 'Enregistrement…' : deliveryReady ? (publishNow ? 'Publier maintenant' : 'Programmer') : 'Ajouter au Planner'} <ChevronRight size={16} /></button>
          {!deliveryReady && <small className="sc3-delivery-note">Le Planner est opérationnel. La diffusion automatique externe reste désactivée tant que le connecteur de publication du réseau n’est pas validé.</small>}
        </aside>
      </section>
    </div>
  );
}

function SettingsPage({ session, connections, runtime, onConnectInstagram, onRefresh }: {
  session: SessionPayload;
  connections: LiveConnection[];
  runtime: LiveRuntimeStateV3;
  onConnectInstagram: (id?: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="sc3-settings-page">
      <div className="sc3-page-head compact"><div><h1>Réglages</h1><p>Uniquement les connexions et votre accès.</p></div><button className="sc3-secondary" onClick={onRefresh}><RefreshCw size={15} /> Actualiser</button></div>
      <div className="sc3-settings-grid">
        <section><h3>Comptes sociaux</h3>{connections.map((connection) => <div className="sc3-setting-account" key={connection.id}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || 'Identifiant non renseigné'}</small></span><b>{connection.status}</b>{connection.platform === 'instagram' && connection.status !== 'connected' && <button onClick={() => onConnectInstagram(connection.id)}>Reconnecter</button>}</div>)}<button className="sc3-connect-row" onClick={() => onConnectInstagram()} disabled={!runtime.instagramOAuthReady}><Plus size={16} /> Connecter Instagram</button></section>
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
    <div className="sc3-modal-backdrop" onMouseDown={onClose}>
      <section className="sc3-account-panel" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Comptes sociaux</small><h2>Changer de compte</h2></div><button onClick={onClose}><X size={18} /></button></header>
        <button className="sc3-panel-account" onClick={() => onSwitch('all')}><span className="sc3-all-mark">∞</span><span><strong>Tous les comptes</strong><small>Vue globale</small></span><ChevronRight size={16} /></button>
        <div className="sc3-panel-list">{connections.map((connection) => <button key={connection.id} onClick={() => connection.status === 'connected' && onSwitch(connection.id)}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span><b className={connection.status === 'connected' ? 'ok' : ''}>{connection.status}</b></button>)}</div>
        <div className="sc3-connect-options"><button onClick={() => onConnectInstagram()} disabled={!instagramReady}><PlatformMark platform="instagram" /><span><strong>Ajouter Instagram</strong><small>{instagramReady ? 'Connexion OAuth' : 'Configuration serveur requise'}</small></span><Plus size={16} /></button><button disabled><PlatformMark platform="youtube" /><span><strong>Ajouter YouTube</strong><small>Connecteur non activé</small></span></button><button disabled><PlatformMark platform="tiktok" /><span><strong>Ajouter TikTok</strong><small>Accès partenaire requis</small></span></button></div>
      </section>
    </div>
  );
}

function UploadDialog({ draft, busy, progress, onChange, onClose, onUpload }: {
  draft: UploadDraft;
  busy: boolean;
  progress: number;
  onChange: (draft: UploadDraft) => void;
  onClose: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="sc3-modal-backdrop centered" onMouseDown={onClose}>
      <section className="sc3-upload-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Bibliothèque</small><h2>Importer un contenu</h2></div><button onClick={onClose} disabled={busy}><X size={18} /></button></header>
        <div className="sc3-upload-file"><span>{draft.file.type.startsWith('image/') ? <ImageIcon size={22} /> : <Video size={22} />}</span><div><strong>{draft.file.name}</strong><small>{formatBytes(draft.file.size)}</small></div></div>
        <label>Format<select value={draft.format} disabled={busy} onChange={(event) => onChange({ ...draft, format: event.target.value as MediaFormat })}><option value="post">Post</option>{draft.file.type.startsWith('video/') && <option value="short">Short / Reel</option>}{draft.file.type.startsWith('video/') && <option value="video">Vidéo</option>}<option value="story">Story</option></select></label>
        <label>Titre<input value={draft.title} disabled={busy} onChange={(event) => onChange({ ...draft, title: event.target.value })} maxLength={180} /></label>
        <label>Légende par défaut <span>(optionnel)</span><textarea value={draft.caption} disabled={busy} onChange={(event) => onChange({ ...draft, caption: event.target.value })} maxLength={5000} /></label>
        {busy && <div className="sc3-upload-progress"><span style={{ width: `${progress}%` }} /><small>{progress}%</small></div>}
        <button className="sc3-primary wide" disabled={busy || !draft.title.trim()} onClick={onUpload}>{busy ? 'Import en cours…' : 'Ajouter à la bibliothèque'}</button>
      </section>
    </div>
  );
}

function MediaEditDialog({ item, onClose, onSave, onDelete, onSchedule }: {
  item: MediaItem;
  onClose: () => void;
  onSave: (values: { title: string; caption: string; format: MediaFormat }) => void;
  onDelete: () => void;
  onSchedule: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [caption, setCaption] = useState(item.caption);
  const [format, setFormat] = useState<MediaFormat>(item.format);
  return (
    <div className="sc3-modal-backdrop centered" onMouseDown={onClose}>
      <section className="sc3-media-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>{mediaFormatLabels[item.format]}</small><h2>{item.title}</h2></div><button onClick={onClose}><X size={18} /></button></header>
        <div className="sc3-dialog-preview">{item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt={item.title} /> : <div><Video size={34} /><span>{item.fileName}</span></div>}</div>
        <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as MediaFormat)}><option value="post">Post</option>{item.mimeType.startsWith('video/') && <option value="short">Short / Reel</option>}{item.mimeType.startsWith('video/') && <option value="video">Vidéo</option>}<option value="story">Story</option></select></label>
        <label>Titre<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} /></label>
        <label>Légende<textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={5000} /></label>
        <div className="sc3-dialog-actions"><button className="danger" onClick={onDelete}><Trash2 size={14} /> Supprimer</button><span /><button className="secondary" onClick={onSchedule}><CalendarDays size={14} /> Programmer</button><button className="sc3-primary" disabled={!title.trim()} onClick={() => onSave({ title: title.trim(), caption, format })}>Enregistrer</button></div>
      </section>
    </div>
  );
}
