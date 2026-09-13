import {
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileImage,
  Inbox as InboxIcon,
  Link2,
  MessageCircle,
  Music2,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  Video,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { demoData } from './shared/demo-data';
import type { Conversation, Platform } from './shared/types';

type Page = 'inbox' | 'publish' | 'calendar' | 'results' | 'more';
type PublishingPlatform = 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube';
type InboxFilter = 'all' | 'unread' | 'messages' | 'comments';
type PublishTiming = 'now' | 'later';

interface PublishingAccount {
  id: string;
  platform: PublishingPlatform;
  name: string;
  handle: string;
  connected: boolean;
  note?: string;
}

interface ScheduledPost {
  id: string;
  content: string;
  accountIds: string[];
  scheduledAt: string;
  status: 'scheduled' | 'draft';
  mediaName?: string;
}

const mainNav: Array<{ id: Exclude<Page, 'more'>; label: string; icon: LucideIcon }> = [
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'publish', label: 'Publier', icon: Plus },
  { id: 'calendar', label: 'Calendrier', icon: CalendarDays },
  { id: 'results', label: 'Résultats', icon: BarChart3 },
];

const publishingAccounts: PublishingAccount[] = [
  { id: 'ig-main', platform: 'instagram', name: 'Neptune Business', handle: '@neptunebusiness', connected: true },
  { id: 'ig-media', platform: 'instagram', name: 'Neptune Media', handle: '@neptunemedia', connected: true },
  { id: 'yt-main', platform: 'youtube', name: 'Neptune Business', handle: '@neptunebusiness', connected: true },
  { id: 'tt-main', platform: 'tiktok', name: 'Neptune Business', handle: '@neptunebusiness', connected: true },
  { id: 'fb-main', platform: 'facebook', name: 'Neptune Business', handle: 'Page Facebook', connected: false, note: 'À connecter' },
  { id: 'li-main', platform: 'linkedin', name: 'Neptune Business', handle: 'Page LinkedIn', connected: false, note: 'À connecter' },
];

const platformLabels: Record<PublishingPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

const resultRows = [
  { title: 'Afterwork : on a cassé les codes', platform: 'Instagram', views: '18,4 k', interactions: '1 246', leads: '31' },
  { title: 'Club d’affaires : les pièges à éviter', platform: 'YouTube', views: '7,8 k', interactions: '412', leads: '18' },
  { title: 'Les ateliers Neptune en 30 secondes', platform: 'TikTok', views: '26,1 k', interactions: '1 804', leads: '12' },
];

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

function makeInitialPosts(): ScheduledPost[] {
  const first = new Date();
  first.setDate(first.getDate() + 1);
  first.setHours(10, 0, 0, 0);
  const second = new Date();
  second.setDate(second.getDate() + 2);
  second.setHours(18, 30, 0, 0);
  return [
    {
      id: 'demo-post-1',
      content: 'Qui a dit qu’un club d’affaires devait être ennuyant ? Prochain afterwork : on vous prouve le contraire.',
      accountIds: ['ig-main', 'li-main'],
      scheduledAt: first.toISOString(),
      status: 'scheduled',
    },
    {
      id: 'demo-post-2',
      content: 'Une minute pour comprendre comment fonctionne Neptune Business.',
      accountIds: ['tt-main', 'yt-main'],
      scheduledAt: second.toISOString(),
      status: 'scheduled',
    },
  ];
}

function platformIcon(platform: PublishingPlatform | Platform, size = 17) {
  if (platform === 'instagram') return <Camera size={size} />;
  if (platform === 'youtube') return <Video size={size} />;
  if (platform === 'tiktok') return <Music2 size={size} />;
  if (platform === 'facebook') return <MessageCircle size={size} />;
  return <Link2 size={size} />;
}

function postKind(conversation: Conversation) {
  if (conversation.platform === 'youtube' || conversation.id === 'conv-5') return 'comment' as const;
  return 'message' as const;
}

function shortScheduleDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function AccountMark({ platform }: { platform: PublishingPlatform | Platform }) {
  return <span className={`platform-mark platform-${platform}`}>{platformIcon(platform)}</span>;
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

export default function App() {
  const [page, setPage] = useState<Page>('inbox');
  const [conversations, setConversations] = useState<Conversation[]>(demoData.conversations);
  const [selectedConversationId, setSelectedConversationId] = useState(demoData.conversations[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [reply, setReply] = useState('');
  const [toast, setToast] = useState('');

  const [caption, setCaption] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(['ig-main']);
  const [mediaName, setMediaName] = useState('');
  const [adaptPerNetwork, setAdaptPerNetwork] = useState(true);
  const [timing, setTiming] = useState<PublishTiming>('later');
  const [scheduleDate, setScheduleDate] = useState(tomorrowKey());
  const [scheduleTime, setScheduleTime] = useState('10:00');
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>(() => {
    try {
      const stored = window.localStorage.getItem('social-conversion.demo.scheduled-posts');
      if (stored) return JSON.parse(stored) as ScheduledPost[];
    } catch {
      // Ignore invalid demo storage and start with safe fixtures.
    }
    return makeInitialPosts();
  });

  useEffect(() => {
    window.localStorage.setItem('social-conversion.demo.scheduled-posts', JSON.stringify(scheduledPosts));
  }, [scheduledPosts]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId),
    [conversations, selectedConversationId],
  );

  const unreadCount = useMemo(
    () => conversations.reduce((total, conversation) => total + conversation.unread, 0),
    [conversations],
  );

  const filteredConversations = useMemo(() => conversations.filter((conversation) => {
    const haystack = `${conversation.name} ${conversation.handle} ${conversation.lastMessage}`.toLowerCase();
    const matchesQuery = haystack.includes(query.toLowerCase());
    const kind = postKind(conversation);
    if (!matchesQuery) return false;
    if (inboxFilter === 'unread') return conversation.unread > 0;
    if (inboxFilter === 'messages') return kind === 'message';
    if (inboxFilter === 'comments') return kind === 'comment';
    return true;
  }), [conversations, inboxFilter, query]);

  const connectedAccounts = publishingAccounts.filter((account) => account.connected);
  const upcomingPosts = useMemo(
    () => [...scheduledPosts].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
    [scheduledPosts],
  );

  function navigate(nextPage: Page) {
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openConversation(id: string) {
    setSelectedConversationId(id);
    setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, unread: 0 } : conversation));
  }

  function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedConversation || !reply.trim()) return;
    const body = reply.trim();
    setConversations((current) => current.map((conversation) => conversation.id === selectedConversation.id
      ? {
        ...conversation,
        lastMessage: body,
        time: 'À l’instant',
        unread: 0,
        messages: [
          ...conversation.messages,
          {
            id: crypto.randomUUID(),
            direction: 'outbound',
            sender: 'Neptune',
            body,
            timestamp: 'À l’instant',
          },
        ],
      }
      : conversation));
    setReply('');
    setToast('Réponse ajoutée dans la démo. Le live reste soumis aux permissions du réseau.');
  }

  function suggestReply() {
    if (!selectedConversation) return;
    setReply(`Bonjour ${selectedConversation.name.split(' ')[0]}, avec plaisir. Quel est votre objectif principal en ce moment : trouver des clients, des partenaires ou développer votre réseau ?`);
  }

  function toggleAccount(id: string) {
    const account = publishingAccounts.find((candidate) => candidate.id === id);
    if (!account?.connected) {
      setToast(`${account?.name ?? 'Ce compte'} doit d’abord être connecté.`);
      return;
    }
    setSelectedAccounts((current) => current.includes(id) ? current.filter((accountId) => accountId !== id) : [...current, id]);
  }

  function resetComposer() {
    setCaption('');
    setMediaName('');
    setSelectedAccounts(['ig-main']);
    setTiming('later');
    setScheduleDate(tomorrowKey());
    setScheduleTime('10:00');
  }

  function schedulePublication() {
    if (!caption.trim()) {
      setToast('Ajoutez un texte avant de continuer.');
      return;
    }
    if (selectedAccounts.length === 0) {
      setToast('Choisissez au moins un compte connecté.');
      return;
    }

    const scheduledAt = timing === 'now'
      ? new Date().toISOString()
      : new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();

    const post: ScheduledPost = {
      id: crypto.randomUUID(),
      content: caption.trim(),
      accountIds: selectedAccounts,
      scheduledAt,
      status: 'scheduled',
      mediaName: mediaName || undefined,
    };
    setScheduledPosts((current) => [...current, post]);
    setToast(timing === 'now' ? 'Publication ajoutée à la file de diffusion.' : 'Publication programmée.');
    resetComposer();
    navigate('calendar');
  }

  function editScheduledPost(post: ScheduledPost) {
    setCaption(post.content);
    setSelectedAccounts(post.accountIds.filter((id) => publishingAccounts.some((account) => account.id === id && account.connected)));
    setMediaName(post.mediaName ?? '');
    const date = new Date(post.scheduledAt);
    setScheduleDate(localDateKey(date));
    setScheduleTime(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
    setTiming('later');
    setScheduledPosts((current) => current.filter((candidate) => candidate.id !== post.id));
    navigate('publish');
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
                {item.id === 'inbox' && unreadCount > 0 && <b>{unreadCount}</b>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-mini">
            <span className="pulse-dot" />
            <span><strong>{connectedAccounts.length} comptes prêts</strong><small>{publishingAccounts.length - connectedAccounts.length} à connecter</small></span>
          </div>
          <button className={`settings-link ${page === 'more' ? 'active' : ''}`} onClick={() => navigate('more')}>
            <Settings2 size={18} /> Réglages avancés
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-orbit">N</span><strong>Social Conversion</strong></div>
          <div className="topbar-title">
            <strong>{page === 'inbox' ? 'Inbox' : page === 'publish' ? 'Créer une publication' : page === 'calendar' ? 'Calendrier' : page === 'results' ? 'Résultats' : 'Réglages avancés'}</strong>
            <small>{demoData.workspace.mode === 'demo' ? 'Mode démonstration' : 'Live'}</small>
          </div>
          <div className="topbar-actions">
            <button className="icon-only mobile-settings" onClick={() => navigate('more')} aria-label="Réglages"><Settings2 size={19} /></button>
            <button className="create-button" onClick={() => navigate('publish')}><Plus size={17} /> Créer</button>
          </div>
        </header>

        <main className="page-content">
          {page === 'inbox' && (
            <InboxPage
              conversations={filteredConversations}
              selectedConversation={selectedConversation}
              query={query}
              filter={inboxFilter}
              reply={reply}
              onQuery={setQuery}
              onFilter={setInboxFilter}
              onSelect={openConversation}
              onReply={setReply}
              onSend={sendReply}
              onSuggest={suggestReply}
            />
          )}

          {page === 'publish' && (
            <PublishPage
              caption={caption}
              selectedAccounts={selectedAccounts}
              mediaName={mediaName}
              adaptPerNetwork={adaptPerNetwork}
              timing={timing}
              scheduleDate={scheduleDate}
              scheduleTime={scheduleTime}
              onCaption={setCaption}
              onToggleAccount={toggleAccount}
              onMediaName={setMediaName}
              onAdapt={setAdaptPerNetwork}
              onTiming={setTiming}
              onScheduleDate={setScheduleDate}
              onScheduleTime={setScheduleTime}
              onSchedule={schedulePublication}
            />
          )}

          {page === 'calendar' && <CalendarPage posts={upcomingPosts} onEdit={editScheduledPost} onCreate={() => navigate('publish')} />}
          {page === 'results' && <ResultsPage />}
          {page === 'more' && <MorePage notify={setToast} />}
        </main>
      </section>

      <nav className="mobile-nav" aria-label="Navigation mobile">
        {mainNav.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>
              <Icon size={19} />
              <span>{item.label}</span>
              {item.id === 'inbox' && unreadCount > 0 && <b>{unreadCount}</b>}
            </button>
          );
        })}
      </nav>

      {toast && <Toast text={toast} onClose={() => setToast('')} />}
    </div>
  );
}

function InboxPage({
  conversations,
  selectedConversation,
  query,
  filter,
  reply,
  onQuery,
  onFilter,
  onSelect,
  onReply,
  onSend,
  onSuggest,
}: {
  conversations: Conversation[];
  selectedConversation?: Conversation;
  query: string;
  filter: InboxFilter;
  reply: string;
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
        <div className="page-intro compact">
          <div><span className="eyebrow">Tout au même endroit</span><h1>À qui répondre ?</h1></div>
        </div>
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Rechercher une personne…" /></label>
        <div className="filter-row">
          {([
            ['all', 'Tout'],
            ['unread', 'À traiter'],
            ['messages', 'Messages'],
            ['comments', 'Commentaires'],
          ] as Array<[InboxFilter, string]>).map(([value, label]) => (
            <button key={value} className={filter === value ? 'active' : ''} onClick={() => onFilter(value)}>{label}</button>
          ))}
        </div>
        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button key={conversation.id} className={`conversation-item ${selectedConversation?.id === conversation.id ? 'active' : ''}`} onClick={() => onSelect(conversation.id)}>
              <span className="avatar">{conversation.initials}</span>
              <span className="conversation-copy">
                <span><strong>{conversation.name}</strong><time>{conversation.time}</time></span>
                <small>{conversation.lastMessage}</small>
                <span className="conversation-source"><AccountMark platform={conversation.platform} /> {postKind(conversation) === 'comment' ? 'Commentaire' : 'Message'} · {conversation.account}</span>
              </span>
              {conversation.unread > 0 && <b className="unread-dot">{conversation.unread}</b>}
            </button>
          ))}
          {conversations.length === 0 && <div className="empty-simple"><Search size={22} /><strong>Aucun résultat</strong><span>Essayez un autre filtre.</span></div>}
        </div>
      </section>

      <section className="thread-panel">
        {selectedConversation ? (
          <>
            <header className="thread-header">
              <div className="thread-person"><span className="avatar large">{selectedConversation.initials}</span><span><strong>{selectedConversation.name}</strong><small>{selectedConversation.handle} · {selectedConversation.account}</small></span></div>
              <span className="simple-stage">{selectedConversation.stage}</span>
            </header>
            <div className="thread-messages">
              {selectedConversation.messages.map((message) => (
                <div key={message.id} className={`message ${message.direction}`}>
                  <div>{message.body}</div>
                  <small>{message.timestamp}{message.aiAssisted ? ' · assisté IA' : ''}</small>
                </div>
              ))}
            </div>
            <div className="reply-area">
              <button className="ai-shortcut" onClick={onSuggest}><Sparkles size={16} /> Proposer une réponse</button>
              <form onSubmit={onSend}>
                <button type="button" className="composer-icon" aria-label="Joindre un fichier"><Paperclip size={18} /></button>
                <textarea value={reply} onChange={(event) => onReply(event.target.value)} placeholder="Écrire une réponse…" rows={2} />
                <button className="send-button" type="submit" disabled={!reply.trim()} aria-label="Envoyer"><Send size={18} /></button>
              </form>
              <small className="reply-note">La démo n’envoie rien vers les réseaux. En live, l’envoi dépend des permissions de chaque compte.</small>
            </div>
          </>
        ) : <div className="empty-thread"><MessageCircle size={28} /><strong>Choisissez une conversation</strong><span>Messages et commentaires arrivent ici.</span></div>}
      </section>

      {selectedConversation && (
        <aside className="contact-panel">
          <span className="avatar xlarge">{selectedConversation.initials}</span>
          <h3>{selectedConversation.name}</h3>
          <p>{selectedConversation.handle}</p>
          <div className="contact-facts">
            <span><small>Intention</small><strong>{selectedConversation.intent}</strong></span>
            <span><small>Étape</small><strong>{selectedConversation.stage}</strong></span>
            <span><small>Valeur estimée</small><strong>{selectedConversation.estimatedValue ? `${selectedConversation.estimatedValue.toLocaleString('fr-FR')} €` : 'À qualifier'}</strong></span>
          </div>
          <button className="secondary-wide">Voir la fiche contact <ChevronRight size={16} /></button>
        </aside>
      )}
    </div>
  );
}

function PublishPage({
  caption,
  selectedAccounts,
  mediaName,
  adaptPerNetwork,
  timing,
  scheduleDate,
  scheduleTime,
  onCaption,
  onToggleAccount,
  onMediaName,
  onAdapt,
  onTiming,
  onScheduleDate,
  onScheduleTime,
  onSchedule,
}: {
  caption: string;
  selectedAccounts: string[];
  mediaName: string;
  adaptPerNetwork: boolean;
  timing: PublishTiming;
  scheduleDate: string;
  scheduleTime: string;
  onCaption: (value: string) => void;
  onToggleAccount: (id: string) => void;
  onMediaName: (value: string) => void;
  onAdapt: (value: boolean) => void;
  onTiming: (value: PublishTiming) => void;
  onScheduleDate: (value: string) => void;
  onScheduleTime: (value: string) => void;
  onSchedule: () => void;
}) {
  const selectedConnected = publishingAccounts.filter((account) => selectedAccounts.includes(account.id));
  return (
    <div className="publish-page">
      <div className="page-intro">
        <div><span className="eyebrow">3 étapes, pas plus</span><h1>Créer une publication</h1><p>Ajoutez le contenu, choisissez les comptes, puis dites quand publier.</p></div>
        <div className="step-indicator"><span className="active">1 Contenu</span><i /><span className={selectedAccounts.length ? 'active' : ''}>2 Comptes</span><i /><span className="active">3 Quand</span></div>
      </div>

      <div className="publish-grid">
        <section className="composer-card">
          <div className="section-heading"><span className="section-number">1</span><div><h2>Votre contenu</h2><p>Un seul contenu de départ. Social Conversion prépare les variantes.</p></div></div>
          <textarea className="caption-box" value={caption} onChange={(event) => onCaption(event.target.value)} placeholder="Qu’est-ce que vous voulez publier ?" maxLength={5000} />
          <label className={`media-drop ${mediaName ? 'has-file' : ''}`}>
            <input type="file" accept="image/*,video/*" onChange={(event) => onMediaName(event.target.files?.[0]?.name ?? '')} />
            <span className="media-icon"><FileImage size={22} /></span>
            <span><strong>{mediaName || 'Ajouter une photo ou une vidéo'}</strong><small>{mediaName ? 'Cliquez pour remplacer le fichier' : 'Glissez votre fichier ici ou cliquez'}</small></span>
            {mediaName && <Check size={18} />}
          </label>

          <div className="adapt-row">
            <span><Sparkles size={17} /><span><strong>Adapter à chaque réseau</strong><small>Format, longueur et ton préparés automatiquement</small></span></span>
            <button role="switch" aria-checked={adaptPerNetwork} className={`switch ${adaptPerNetwork ? 'on' : ''}`} onClick={() => onAdapt(!adaptPerNetwork)}><span /></button>
          </div>
        </section>

        <aside className="preview-card">
          <span className="eyebrow">Aperçu</span>
          <div className="preview-phone">
            <div className="preview-account"><span className="preview-avatar">N</span><span><strong>Neptune Business</strong><small>{selectedConnected.length ? `${selectedConnected.length} compte${selectedConnected.length > 1 ? 's' : ''} sélectionné${selectedConnected.length > 1 ? 's' : ''}` : 'Choisissez un compte'}</small></span></div>
            <div className="preview-media">{mediaName ? <><Video size={30} /><small>{mediaName}</small></> : <><Camera size={30} /><small>Votre média apparaîtra ici</small></>}</div>
            <p>{caption || 'Votre texte apparaîtra ici pendant que vous l’écrivez.'}</p>
            {adaptPerNetwork && caption && <span className="adapted-badge"><Sparkles size={13} /> variantes activées</span>}
          </div>
        </aside>
      </div>

      <section className="publish-section">
        <div className="section-heading"><span className="section-number">2</span><div><h2>Où publier ?</h2><p>Sélectionnez les comptes. Les comptes non prêts restent clairement bloqués.</p></div></div>
        <div className="account-picker">
          {publishingAccounts.map((account) => {
            const selected = selectedAccounts.includes(account.id);
            return (
              <button key={account.id} className={`account-choice ${selected ? 'selected' : ''} ${!account.connected ? 'disabled' : ''}`} onClick={() => onToggleAccount(account.id)}>
                <AccountMark platform={account.platform} />
                <span><strong>{account.name}</strong><small>{platformLabels[account.platform]} · {account.handle}</small></span>
                <span className={`choice-state ${selected ? 'selected' : ''}`}>{account.connected ? (selected ? <Check size={14} /> : '') : account.note}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="publish-section timing-section">
        <div className="section-heading"><span className="section-number">3</span><div><h2>Quand ?</h2><p>Maintenant ou plus tard. Rien d’autre à configurer.</p></div></div>
        <div className="timing-options">
          <button className={timing === 'now' ? 'active' : ''} onClick={() => onTiming('now')}><Zap size={18} /><span><strong>Maintenant</strong><small>Ajouter à la file de diffusion</small></span></button>
          <button className={timing === 'later' ? 'active' : ''} onClick={() => onTiming('later')}><CalendarDays size={18} /><span><strong>Programmer</strong><small>Choisir une date et une heure</small></span></button>
          {timing === 'later' && <div className="datetime-fields"><label><span>Date</span><input type="date" value={scheduleDate} min={localDateKey(new Date())} onChange={(event) => onScheduleDate(event.target.value)} /></label><label><span>Heure</span><input type="time" value={scheduleTime} onChange={(event) => onScheduleTime(event.target.value)} /></label></div>}
        </div>
        <div className="publish-submit-row">
          <span><Check size={16} /><strong>{selectedAccounts.length}</strong> compte{selectedAccounts.length > 1 ? 's' : ''} sélectionné{selectedAccounts.length > 1 ? 's' : ''}</span>
          <button className="primary-large" onClick={onSchedule}>{timing === 'now' ? 'Publier maintenant' : 'Programmer la publication'} <ChevronRight size={17} /></button>
        </div>
      </section>
    </div>
  );
}

function CalendarPage({ posts, onEdit, onCreate }: { posts: ScheduledPost[]; onEdit: (post: ScheduledPost) => void; onCreate: () => void }) {
  const grouped = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    posts.forEach((post) => {
      const key = localDateKey(new Date(post.scheduledAt));
      map.set(key, [...(map.get(key) ?? []), post]);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [posts]);

  return (
    <div className="calendar-page">
      <div className="page-intro">
        <div><span className="eyebrow">Vue simple</span><h1>Ce qui va être publié</h1><p>Une liste chronologique. Aucun calendrier usine à gaz.</p></div>
        <button className="primary-small" onClick={onCreate}><Plus size={16} /> Nouvelle publication</button>
      </div>

      <div className="calendar-summary">
        <span><strong>{posts.length}</strong><small>programmées</small></span>
        <span><strong>{posts.reduce((total, post) => total + post.accountIds.length, 0)}</strong><small>diffusions prévues</small></span>
        <span><strong>{new Set(posts.flatMap((post) => post.accountIds)).size}</strong><small>comptes concernés</small></span>
      </div>

      <section className="timeline">
        {grouped.map(([date, dayPosts]) => (
          <div className="timeline-day" key={date}>
            <div className="day-label"><strong>{new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(new Date(`${date}T12:00:00`))}</strong><span>{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`))}</span></div>
            <div className="day-posts">
              {dayPosts.map((post) => (
                <article className="scheduled-card" key={post.id}>
                  <div className="scheduled-time"><Clock3 size={15} /> {new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(post.scheduledAt))}</div>
                  <div className="scheduled-copy"><strong>{post.content}</strong>{post.mediaName && <small><FileImage size={13} /> {post.mediaName}</small>}</div>
                  <div className="scheduled-accounts">{post.accountIds.map((id) => {
                    const account = publishingAccounts.find((candidate) => candidate.id === id);
                    return account ? <AccountMark key={id} platform={account.platform} /> : null;
                  })}</div>
                  <button className="edit-button" onClick={() => onEdit(post)}>Modifier</button>
                </article>
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && <div className="calendar-empty"><CalendarDays size={28} /><strong>Rien de programmé</strong><span>Créez votre première publication.</span><button onClick={onCreate}>Créer maintenant</button></div>}
      </section>
    </div>
  );
}

function ResultsPage() {
  return (
    <div className="results-page">
      <div className="page-intro"><div><span className="eyebrow">Comprendre en 10 secondes</span><h1>Ce qui fonctionne vraiment</h1><p>Pas 40 graphiques : portée, interactions et business généré.</p></div><button className="period-button"><CalendarDays size={16} /> 30 derniers jours</button></div>
      <section className="result-metrics">
        <article><span>Personnes touchées</span><strong>84 260</strong><small>sur tous les comptes</small></article>
        <article><span>Interactions</span><strong>5 482</strong><small>messages, commentaires, réactions</small></article>
        <article><span>Conversations</span><strong>183</strong><small>ouvertes depuis les réseaux</small></article>
        <article className="highlight"><span>Leads générés</span><strong>61</strong><small>33 % des conversations</small></article>
      </section>
      <section className="results-table-card">
        <div className="section-heading simple"><div><h2>Vos meilleurs contenus</h2><p>Ceux qui ont réellement créé de l’intérêt.</p></div></div>
        <div className="results-table">
          <div className="results-head"><span>Contenu</span><span>Vues</span><span>Interactions</span><span>Leads</span></div>
          {resultRows.map((row) => (
            <div className="results-row" key={row.title}><span><strong>{row.title}</strong><small>{row.platform}</small></span><strong>{row.views}</strong><strong>{row.interactions}</strong><strong>{row.leads}</strong></div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MorePage({ notify }: { notify: (text: string) => void }) {
  return (
    <div className="more-page">
      <div className="page-intro"><div><span className="eyebrow">Secondaire</span><h1>Réglages avancés</h1><p>Tout ce qui n’a pas besoin d’être sous vos yeux chaque jour.</p></div></div>
      <div className="advanced-grid">
        <article className="advanced-card"><span className="advanced-icon"><Link2 size={20} /></span><div><h3>Comptes connectés</h3><p>Gérer les autorisations Instagram, YouTube, TikTok, Facebook et LinkedIn.</p></div><button onClick={() => notify('La gestion OAuth reste reliée aux connecteurs réels du backend.')}>Gérer <ChevronRight size={15} /></button></article>
        <article className="advanced-card"><span className="advanced-icon"><Zap size={20} /></span><div><h3>Automatisations</h3><p>Réponses suggérées, qualification et actions après un commentaire ou un message.</p></div><button onClick={() => notify('Les automatisations existantes restent disponibles en arrière-plan.')}>Gérer <ChevronRight size={15} /></button></article>
        <article className="advanced-card"><span className="advanced-icon"><Sparkles size={20} /></span><div><h3>IA et ton de marque</h3><p>Définir le ton, les règles et ce que l’assistant peut proposer.</p></div><button onClick={() => notify('Le copilote IA conserve une validation humaine obligatoire.')}>Configurer <ChevronRight size={15} /></button></article>
        <article className="advanced-card"><span className="advanced-icon"><CircleHelp size={20} /></span><div><h3>État des connecteurs</h3><p>Voir ce qui est réellement disponible ou bloqué par chaque plateforme.</p></div><button onClick={() => notify('Instagram : permissions Meta requises · TikTok : Business Messaging partenaire · YouTube : commentaires uniquement.')}>Voir l’état <ChevronRight size={15} /></button></article>
      </div>
    </div>
  );
}
