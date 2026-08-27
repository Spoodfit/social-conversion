import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Database,
  Filter,
  Gauge,
  KanbanSquare,
  Link2,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Paperclip,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  Video,
  UsersRound,
  WandSparkles,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { demoData } from './shared/demo-data';
import type {
  AutomationRule,
  BootstrapData,
  Conversation,
  Lead,
  LeadStage,
  Platform,
  SocialConnection,
} from './shared/types';

type Page = 'dashboard' | 'connections' | 'inbox' | 'automations' | 'crm' | 'analytics' | 'settings';

const navItems: Array<{ id: Page; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: 'Vue d’ensemble', icon: Gauge },
  { id: 'connections', label: 'Connexions', icon: Link2 },
  { id: 'inbox', label: 'Inbox sociale', icon: MessageCircle },
  { id: 'automations', label: 'Automatisations', icon: Zap },
  { id: 'crm', label: 'Pipeline CRM', icon: KanbanSquare },
  { id: 'analytics', label: 'Analyses', icon: BarChart3 },
  { id: 'settings', label: 'Paramètres IA', icon: Settings2 },
];

const pageTitles: Record<Page, string> = {
  dashboard: 'Vue d’ensemble',
  connections: 'Connexions sociales',
  inbox: 'Inbox sociale',
  automations: 'Automatisations',
  crm: 'Pipeline CRM',
  analytics: 'Analyses de conversion',
  settings: 'Paramètres IA',
};

const platformLabels: Record<Platform, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

const metricIcons = [Activity, MessageCircle, Target, TrendingUp];

function MetricIcon({ index }: { index: number }) {
  const Icon = metricIcons[index] ?? Activity;
  return <Icon size={19} />;
}

function PlatformIcon({ platform, size = 16 }: { platform: Platform; size?: number }) {
  if (platform === 'instagram') return <Camera size={size} />;
  if (platform === 'youtube') return <Video size={size} />;
  return <Music2 size={size} />;
}

function PlatformBadge({ platform, label = true }: { platform: Platform; label?: boolean }) {
  return (
    <span className={`platform-badge ${platform}`} title={platformLabels[platform]}>
      <PlatformIcon platform={platform} size={14} />
      {label && <span>{platformLabels[platform]}</span>}
    </span>
  );
}

function Avatar({ initials, large = false }: { initials: string; large?: boolean }) {
  return <span className={`avatar ${large ? 'avatar-large' : ''}`}>{initials}</span>;
}

function Button({
  children,
  variant = 'primary',
  icon: Icon,
  onClick,
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: LucideIcon;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type={type} className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled}>
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={onChange}>
      <span />
    </button>
  );
}

function Modal({ title, eyebrow, onClose, children, wide = false }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id="modal-title">{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fermer"><X size={20} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><Search size={24} /><strong>{title}</strong><span>{body}</span></div>;
}

function Dashboard({ data, navigate }: { data: BootstrapData; navigate: (page: Page) => void }) {
  const hottestLeads = [...data.leads].sort((a, b) => b.score - a.score).slice(0, 3);
  return (
    <div className="page-stack">
      <section className="page-heading-row">
        <div><p className="page-kicker">Pilotage commercial</p><h1>Bonjour, Neptune 👋</h1><p>Voici ce que vos réseaux ont généré ces 30 derniers jours.</p></div>
        <div className="heading-actions"><button className="date-control"><Clock3 size={16} /> 30 derniers jours <ChevronDown size={15} /></button><Button icon={RefreshCw} variant="secondary">Actualiser</Button></div>
      </section>

      <section className="metric-grid" aria-label="Indicateurs clés">
        {data.metrics.map((metric, index) => (
          <article className="metric-card" key={metric.label}>
            <div className={`metric-icon metric-icon-${index + 1}`}><MetricIcon index={index} /></div>
            <div className="metric-copy"><span>{metric.label}</span><strong>{metric.value}</strong></div>
            <span className={`delta ${metric.direction}`}>{metric.direction === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{metric.delta}</span>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel conversion-panel">
          <div className="panel-heading"><div><span className="eyebrow">Parcours social</span><h2>Entonnoir de conversion</h2></div><button className="text-button" onClick={() => navigate('analytics')}>Voir l’analyse <ArrowRight size={15} /></button></div>
          <div className="funnel">
            {data.funnel.map((step, index) => (
              <div className="funnel-row" key={step.label}>
                <div className="funnel-label"><span>{step.label}</span><strong>{step.value.toLocaleString('fr-FR')}</strong></div>
                <div className="funnel-track"><span style={{ width: `${step.percent}%` }} /><small>{step.percent}%</small></div>
                {index < data.funnel.length - 1 && <span className="funnel-rate">{Math.round((data.funnel[index + 1]!.value / step.value) * 100)}%</span>}
              </div>
            ))}
          </div>
        </article>

        <article className="panel activity-panel">
          <div className="panel-heading"><div><span className="eyebrow">7 derniers jours</span><h2>Conversations</h2></div><span className="total-badge">456 total</span></div>
          <div className="bar-chart" aria-label="Activité hebdomadaire">
            {data.weeklyActivity.map((value, index) => <div className="bar-column" key={index}><span className="bar-value">{value}</span><span className="bar" style={{ height: `${value}%` }} /><small>{['L', 'M', 'M', 'J', 'V', 'S', 'D'][index]}</small></div>)}
          </div>
          <div className="activity-summary"><span><i className="dot instagram-dot" /> Instagram <strong>68%</strong></span><span><i className="dot youtube-dot" /> YouTube <strong>21%</strong></span><span><i className="dot tiktok-dot" /> TikTok <strong>11%</strong></span></div>
        </article>
      </section>

      <section className="dashboard-lower-grid">
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Priorité commerciale</span><h2>Leads à traiter</h2></div><button className="text-button" onClick={() => navigate('crm')}>Ouvrir le CRM <ArrowRight size={15} /></button></div>
          <div className="lead-list">
            {hottestLeads.map((lead) => <div className="lead-row" key={lead.id}><Avatar initials={lead.initials} /><div className="grow"><strong>{lead.name}</strong><span>{lead.handle} · {lead.lastActivity}</span></div><PlatformBadge platform={lead.source} label={false} /><span className="score">{lead.score}</span><span className="value">{lead.value ? `${lead.value.toLocaleString('fr-FR')} €` : 'À estimer'}</span></div>)}
          </div>
        </article>
        <article className="panel quick-actions">
          <div className="panel-heading"><div><span className="eyebrow">Démarrage rapide</span><h2>Prochaines actions</h2></div></div>
          <button onClick={() => navigate('connections')}><span className="quick-icon"><Link2 size={18} /></span><span><strong>Finaliser TikTok</strong><small>Accès Business Messaging à valider</small></span><ChevronRight size={18} /></button>
          <button onClick={() => navigate('inbox')}><span className="quick-icon"><MessageCircle size={18} /></span><span><strong>Répondre à 3 contacts</strong><small>2 conversations prioritaires</small></span><ChevronRight size={18} /></button>
          <button onClick={() => navigate('automations')}><span className="quick-icon"><Zap size={18} /></span><span><strong>Tester une automatisation</strong><small>Vérifier avant mise en ligne</small></span><ChevronRight size={18} /></button>
        </article>
      </section>
    </div>
  );
}

function ConnectionCard({ connection, notify }: { connection: SocialConnection; notify: (text: string) => void }) {
  const statusLabel = connection.status === 'connected' ? 'Connecté' : connection.status === 'attention' ? 'À vérifier' : 'Accès limité';
  return (
    <article className="connection-card">
      <div className="connection-top">
        <span className="connection-logo" style={{ '--connection-accent': connection.accent } as React.CSSProperties}><PlatformIcon platform={connection.platform} size={22} /></span>
        <span className={`status-pill ${connection.status}`}><i /> {statusLabel}</span>
        <button className="icon-button"><MoreHorizontal size={19} /></button>
      </div>
      <div className="connection-identity"><h3>{connection.name}</h3><p>{connection.handle}</p><small>Synchronisé : {connection.lastSync}</small></div>
      <div className="capability-list">
        {connection.capabilities.map((capability) => <div key={capability.key} className={capability.available ? 'available' : 'unavailable'}><span>{capability.available ? <Check size={14} /> : <X size={14} />}{capability.label}</span>{capability.note && <span className="capability-note" title={capability.note}><CircleHelp size={14} /></span>}</div>)}
      </div>
      <div className="connection-actions">
        <Button variant="secondary" icon={RefreshCw} onClick={() => notify(`${connection.name} vient d’être resynchronisé.`)}>Synchroniser</Button>
        <button className="text-button" onClick={() => notify(`Configuration de ${connection.name} ouverte en mode démonstration.`)}>Configurer <ArrowRight size={15} /></button>
      </div>
    </article>
  );
}

function Connections({ connections, notify }: { connections: SocialConnection[]; notify: (text: string) => void }) {
  return (
    <div className="page-stack">
      <section className="page-heading-row"><div><p className="page-kicker">Canaux et permissions</p><h1>Connexions sociales</h1><p>Connectez les comptes, puis laissez les capacités réelles piloter ce que l’interface autorise.</p></div><Button icon={Plus} onClick={() => notify('L’assistant OAuth sera activé après création des apps développeur.')}>Ajouter un compte</Button></section>
      <div className="info-banner"><ShieldCheck size={20} /><div><strong>Aucun mot de passe social n’est stocké.</strong><span>Les jetons OAuth seront enregistrés comme secrets Cloudflare et chaque action restera liée aux permissions accordées par la plateforme.</span></div></div>
      <section className="connection-grid">{connections.map((connection) => <ConnectionCard key={connection.id} connection={connection} notify={notify} />)}<button className="add-connection-card" onClick={() => notify('Choisissez Instagram, YouTube ou TikTok dans l’assistant OAuth.')}><Plus size={24} /><strong>Connecter un autre compte</strong><span>Instagram · YouTube · TikTok</span></button></section>
    </div>
  );
}

function Inbox({ initialConversations, notify }: { initialConversations: Conversation[]; notify: (text: string) => void }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(initialConversations[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [draft, setDraft] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const selected = conversations.find((conversation) => conversation.id === selectedId);
  const filtered = conversations.filter((conversation) => (platform === 'all' || conversation.platform === platform) && `${conversation.name} ${conversation.handle} ${conversation.lastMessage}`.toLowerCase().includes(query.toLowerCase()));

  async function suggestReply() {
    if (!selected) return;
    setSuggesting(true);
    try {
      const response = await fetch('/api/ai/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: selected.intent, name: selected.name }) });
      const payload = await response.json() as { suggestion?: string };
      setDraft(payload.suggestion ?? 'Avec plaisir. Pouvez-vous me préciser votre objectif principal ?');
    } catch {
      setDraft('Avec plaisir. Pouvez-vous me préciser votre objectif principal ?');
    } finally {
      setSuggesting(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    const body = draft.trim();
    try {
      const response = await fetch('/api/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: selected.id, message: body }) });
      if (!response.ok) throw new Error('send failed');
      setConversations((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, lastMessage: body, time: 'À l’instant', messages: [...conversation.messages, { id: crypto.randomUUID(), direction: 'outbound', sender: 'Neptune', body, timestamp: 'À l’instant' }] } : conversation));
      setDraft('');
      notify('Réponse simulée avec succès. Le connecteur réel prendra le relais en mode live.');
    } catch {
      notify('Envoi impossible : vérifiez la connexion au Worker.');
    }
  }

  function updateStage(stage: LeadStage) {
    if (!selected) return;
    setConversations((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, stage } : conversation));
    notify(`${selected.name} est maintenant à l’étape « ${stage} ».`);
  }

  return (
    <div className="inbox-page">
      <section className="inbox-list-column">
        <div className="inbox-heading"><div><p className="page-kicker">Centre de réponse</p><h1>Inbox sociale</h1></div><button className="icon-button"><PencilLine size={18} /></button></div>
        <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une conversation" /></label>
        <div className="filter-row"><button className={platform === 'all' ? 'active' : ''} onClick={() => setPlatform('all')}>Toutes</button>{(['instagram', 'youtube', 'tiktok'] as Platform[]).map((item) => <button className={platform === item ? 'active' : ''} key={item} onClick={() => setPlatform(item)}><PlatformIcon platform={item} size={15} /></button>)}<button aria-label="Plus de filtres"><SlidersHorizontal size={15} /></button></div>
        <div className="conversation-list">
          {filtered.length ? filtered.map((conversation) => <button key={conversation.id} className={`conversation-item ${selectedId === conversation.id ? 'selected' : ''}`} onClick={() => setSelectedId(conversation.id)}><Avatar initials={conversation.initials} /><span className="conversation-body"><span className="conversation-name"><strong>{conversation.name}</strong><small>{conversation.time}</small></span><span className="conversation-preview">{conversation.lastMessage}</span><span className="conversation-meta"><PlatformBadge platform={conversation.platform} label={false} /><span>{conversation.account}</span>{conversation.priority === 'haute' && <i className="priority-dot" />}</span></span>{conversation.unread > 0 && <span className="unread-badge">{conversation.unread}</span>}</button>) : <EmptyState title="Aucun résultat" body="Essayez un autre filtre." />}
        </div>
      </section>

      {selected ? <>
        <section className="thread-column">
          <div className="thread-heading"><div className="thread-contact"><Avatar initials={selected.initials} /><div><strong>{selected.name}</strong><span>{selected.handle} · {selected.account}</span></div></div><div className="thread-actions"><PlatformBadge platform={selected.platform} /><button className="icon-button"><MoreHorizontal size={18} /></button></div></div>
          <div className="thread-messages">
            <div className="day-divider"><span>Aujourd’hui</span></div>
            {selected.messages.map((message) => <div key={message.id} className={`message-row ${message.direction}`}><div className="message-bubble"><p>{message.body}</p><span>{message.timestamp}{message.aiAssisted && <><Sparkles size={12} /> Assisté par l’IA</>}</span></div></div>)}
          </div>
          <div className="ai-draft-bar"><span><WandSparkles size={16} /><strong>Copilote</strong> génère un brouillon, jamais un envoi autonome.</span><button onClick={suggestReply} disabled={suggesting}>{suggesting ? <RefreshCw className="spin" size={15} /> : <Sparkles size={15} />} Suggérer</button></div>
          <form className="composer" onSubmit={sendMessage}><textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Écrire une réponse…" maxLength={2000} /><div className="composer-footer"><div><button type="button" className="icon-button" aria-label="Joindre un fichier"><Paperclip size={18} /></button><span>{draft.length}/2000</span></div><Button type="submit" icon={Send} disabled={!draft.trim()}>Envoyer</Button></div></form>
        </section>
        <aside className="contact-column">
          <div className="contact-profile"><Avatar initials={selected.initials} large /><h2>{selected.name}</h2><p>{selected.handle}</p><div className="profile-channels"><PlatformBadge platform={selected.platform} /><span className={`sentiment ${selected.sentiment}`}>{selected.sentiment}</span></div></div>
          <div className="contact-section"><span className="section-label">Opportunité</span><label>Étape<select value={selected.stage} onChange={(event) => updateStage(event.target.value as LeadStage)}>{['Nouveau', 'Qualifié', 'Rendez-vous', 'Proposition', 'Gagné'].map((stage) => <option key={stage}>{stage}</option>)}</select></label><label>Valeur estimée<div className="read-only-field">{selected.estimatedValue ? `${selected.estimatedValue.toLocaleString('fr-FR')} €` : 'À estimer'}</div></label><label>Intention<div className="read-only-field">{selected.intent}</div></label></div>
          <div className="contact-section"><span className="section-label">Résumé IA</span><p className="ai-summary">Contact intéressé et engagé. Prochaine meilleure action : proposer deux dates et demander sa ville.</p><button className="text-button" onClick={() => notify('Résumé IA actualisé.')}>Actualiser le résumé <RefreshCw size={14} /></button></div>
        </aside>
      </> : <EmptyState title="Sélectionnez une conversation" body="Le fil et la fiche contact apparaîtront ici." />}
    </div>
  );
}

function AutomationWizard({ onClose, onCreate }: { onClose: () => void; onCreate: (rule: AutomationRule) => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('Qualification événement');
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [trigger, setTrigger] = useState('Commentaire contient un mot-clé');
  const [action, setAction] = useState('Créer un lead et suggérer une réponse');
  function finish() {
    onCreate({ id: crypto.randomUUID(), name, trigger, action, platform, active: false, executions: 0, conversion: 0 });
    onClose();
  }
  return (
    <Modal title="Nouvelle automatisation" eyebrow={`Étape ${step} sur 4`} onClose={onClose} wide>
      <div className="wizard-progress">{[1, 2, 3, 4].map((item) => <span key={item} className={item <= step ? 'active' : ''}><i>{item < step ? <Check size={13} /> : item}</i>{['Départ', 'Déclencheur', 'Action', 'Vérification'][item - 1]}</span>)}</div>
      <div className="wizard-content">
        {step === 1 && <><h3>Où démarre la conversation ?</h3><p>Le canal choisi limite automatiquement les déclencheurs disponibles.</p><div className="choice-grid">{(['instagram', 'youtube', 'tiktok'] as Platform[]).map((item) => <button key={item} className={platform === item ? 'selected' : ''} onClick={() => setPlatform(item)}><PlatformIcon platform={item} size={22} /><strong>{platformLabels[item]}</strong><span>{item === 'instagram' ? 'DM et commentaires' : item === 'youtube' ? 'Commentaires publics' : 'Selon accès partenaire'}</span></button>)}</div><label className="form-field">Nom de la règle<input value={name} onChange={(event) => setName(event.target.value)} /></label></>}
        {step === 2 && <><h3>Quel événement doit déclencher la règle ?</h3><p>Un filtre précis réduit les réponses hors contexte.</p><div className="radio-list">{['Commentaire contient un mot-clé', 'Nouveau message privé', 'Intention détectée par l’IA'].map((item) => <label key={item}><input type="radio" name="trigger" checked={trigger === item} onChange={() => setTrigger(item)} /><span><strong>{item}</strong><small>{item === 'Intention détectée par l’IA' ? 'Coût variable, à utiliser après un filtre simple.' : 'Déclencheur faible coût.'}</small></span></label>)}</div></>}
        {step === 3 && <><h3>Que doit-il se passer ensuite ?</h3><p>Le mode brouillon maintient un humain dans la boucle.</p><div className="radio-list">{['Créer un lead et suggérer une réponse', 'Répondre avec un message approuvé', 'Ajouter une étiquette CRM'].map((item) => <label key={item}><input type="radio" name="action" checked={action === item} onChange={() => setAction(item)} /><span><strong>{item}</strong><small>{item.includes('suggérer') ? 'Recommandé pour le MVP.' : 'Action réversible et tracée.'}</small></span></label>)}</div></>}
        {step === 4 && <><h3>Vérifiez avant d’activer</h3><div className="review-card"><div><span>Canal</span><strong><PlatformBadge platform={platform} /></strong></div><div><span>Déclencheur</span><strong>{trigger}</strong></div><div><span>Action</span><strong>{action}</strong></div><div><span>État initial</span><strong className="draft-state">Brouillon inactif</strong></div></div><div className="info-banner compact"><ShieldCheck size={18} /><div><strong>Le test ne contactera personne.</strong><span>La règle sera créée inactive et pourra être testée avec un exemple.</span></div></div></>}
      </div>
      <div className="modal-footer"><Button variant="ghost" onClick={step === 1 ? onClose : () => setStep(step - 1)}>{step === 1 ? 'Annuler' : 'Retour'}</Button>{step < 4 ? <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !name.trim()}>Continuer <ArrowRight size={15} /></Button> : <Button icon={Check} onClick={finish}>Créer en brouillon</Button>}</div>
    </Modal>
  );
}

function Automations({ initialRules, notify }: { initialRules: AutomationRule[]; notify: (text: string) => void }) {
  const [rules, setRules] = useState(initialRules);
  const [wizardOpen, setWizardOpen] = useState(false);
  function toggleRule(id: string) {
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, active: !rule.active } : rule));
  }
  return (
    <div className="page-stack">
      <section className="page-heading-row"><div><p className="page-kicker">Déclencheurs → actions</p><h1>Automatisations</h1><p>Transformez les signaux sociaux en actions commerciales mesurables.</p></div><Button icon={Plus} onClick={() => setWizardOpen(true)}>Nouvelle automatisation</Button></section>
      <section className="automation-summary"><div><span className="summary-icon violet"><Zap size={19} /></span><span><strong>{rules.filter((rule) => rule.active).length}</strong> actives</span></div><div><span className="summary-icon cyan"><Play size={19} /></span><span><strong>{rules.reduce((sum, rule) => sum + rule.executions, 0)}</strong> exécutions</span></div><div><span className="summary-icon green"><Target size={19} /></span><span><strong>31%</strong> conversion moyenne</span></div></section>
      <section className="rule-list">
        {rules.map((rule) => <article className="rule-card" key={rule.id}><div className="rule-status"><Toggle checked={rule.active} label={`${rule.active ? 'Désactiver' : 'Activer'} ${rule.name}`} onChange={() => toggleRule(rule.id)} /><span className={rule.active ? 'live' : 'draft'}>{rule.active ? 'Active' : 'Brouillon'}</span></div><div className="rule-main"><span className="rule-platform"><PlatformIcon platform={rule.platform} size={18} /></span><div><h3>{rule.name}</h3><p>{rule.caveat ?? 'Dernière exécution réussie · journalisation active'}</p></div></div><div className="rule-flow"><span><small>SI</small>{rule.trigger}</span><ArrowRight size={18} /><span><small>ALORS</small>{rule.action}</span></div><div className="rule-stats"><span><small>Exécutions</small><strong>{rule.executions}</strong></span><span><small>Conversion</small><strong>{rule.conversion}%</strong></span><Button variant="secondary" icon={Play} onClick={() => notify(`Test de « ${rule.name} » réussi, sans envoi externe.`)}>Tester</Button><button className="icon-button"><MoreHorizontal size={18} /></button></div></article>)}
      </section>
      {wizardOpen && <AutomationWizard onClose={() => setWizardOpen(false)} onCreate={(rule) => { setRules((current) => [rule, ...current]); notify('Automatisation créée en brouillon.'); }} />}
    </div>
  );
}

function CRM({ initialLeads, notify }: { initialLeads: Lead[]; notify: (text: string) => void }) {
  const stages: LeadStage[] = ['Nouveau', 'Qualifié', 'Rendez-vous', 'Proposition', 'Gagné'];
  const [leads, setLeads] = useState(initialLeads);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = leads.find((lead) => lead.id === selectedId);
  function moveLead(id: string, stage: LeadStage) {
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, stage } : lead));
    notify(`Lead déplacé vers « ${stage} ».`);
  }
  return (
    <div className="page-stack crm-page">
      <section className="page-heading-row"><div><p className="page-kicker">Pipeline commercial</p><h1>Leads issus des réseaux</h1><p>Une seule vue, de la première interaction au revenu attribué.</p></div><div className="heading-actions"><Button variant="secondary" icon={Filter}>Filtrer</Button><Button icon={Plus} onClick={() => notify('La création manuelle sera reliée à D1 en mode live.')}>Ajouter un lead</Button></div></section>
      <section className="pipeline-summary"><span><strong>{leads.length}</strong> opportunités</span><span><strong>{leads.reduce((sum, lead) => sum + lead.value, 0).toLocaleString('fr-FR')} €</strong> valeur totale</span><span><strong>38%</strong> probabilité pondérée</span></section>
      <section className="kanban-board">
        {stages.map((stage) => { const stageLeads = leads.filter((lead) => lead.stage === stage); return <div className="kanban-column" key={stage}><div className="kanban-heading"><span><i className={`stage-dot stage-${stages.indexOf(stage)}`} />{stage}</span><small>{stageLeads.length}</small></div><div className="kanban-list">{stageLeads.map((lead) => <article className="lead-card" key={lead.id} onClick={() => setSelectedId(lead.id)}><div className="lead-card-top"><Avatar initials={lead.initials} /><PlatformBadge platform={lead.source} label={false} /></div><h3>{lead.name}</h3><p>{lead.handle}</p><div className="tag-list">{lead.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="lead-card-bottom"><span className="score"><Target size={13} /> {lead.score}</span><strong>{lead.value ? `${lead.value.toLocaleString('fr-FR')} €` : 'À estimer'}</strong></div></article>)}</div></div>; })}
      </section>
      {selected && <Modal title={selected.name} eyebrow="Fiche opportunité" onClose={() => setSelectedId(undefined)}><div className="lead-modal-profile"><Avatar initials={selected.initials} large /><div><strong>{selected.handle}</strong><PlatformBadge platform={selected.source} /></div></div><div className="detail-grid"><div><span>Score</span><strong>{selected.score}/100</strong></div><div><span>Valeur</span><strong>{selected.value ? `${selected.value.toLocaleString('fr-FR')} €` : 'À estimer'}</strong></div><div><span>Activité</span><strong>{selected.lastActivity}</strong></div><div><span>Source</span><strong>{platformLabels[selected.source]}</strong></div></div><label className="form-field">Déplacer dans le pipeline<select value={selected.stage} onChange={(event) => moveLead(selected.id, event.target.value as LeadStage)}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label><div className="modal-footer"><Button variant="secondary" onClick={() => setSelectedId(undefined)}>Fermer</Button><Button icon={MessageCircle} onClick={() => notify('Ouverture de la conversation associée prévue dans l’itération suivante.')}>Voir la conversation</Button></div></Modal>}
    </div>
  );
}

function Analytics({ data }: { data: BootstrapData }) {
  const maxRevenue = Math.max(...data.sources.map((source) => source.revenue));
  return (
    <div className="page-stack">
      <section className="page-heading-row"><div><p className="page-kicker">Attribution sociale</p><h1>Analyses de conversion</h1><p>Identifiez les canaux et les automatisations qui produisent réellement du revenu.</p></div><button className="date-control"><Clock3 size={16} /> 30 derniers jours <ChevronDown size={15} /></button></section>
      <section className="analytics-hero"><div><span>Taux interaction → lead</span><strong>3,02%</strong><small><ArrowUpRight size={14} /> +0,6 point</small></div><div><span>Valeur moyenne d’un lead</span><strong>365 €</strong><small><ArrowUpRight size={14} /> +11%</small></div><div><span>Délai moyen de réponse</span><strong>4 min 18</strong><small className="neutral">Objectif &lt; 5 min</small></div></section>
      <section className="analytics-grid">
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Revenu attribué</span><h2>Performance par canal</h2></div></div><div className="source-performance">{data.sources.map((source) => <div key={source.platform}><div className="source-label"><PlatformBadge platform={source.platform} /><strong>{source.revenue.toLocaleString('fr-FR')} €</strong></div><div className="revenue-track"><span className={source.platform} style={{ width: `${(source.revenue / maxRevenue) * 100}%` }} /></div><div className="source-meta"><span>{source.conversations} conversations</span><span>{source.qualified} qualifiées</span><span>{Math.round((source.qualified / source.conversations) * 100)}% conv.</span></div></div>)}</div></article>
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Lecture rapide</span><h2>Ce qui fonctionne</h2></div></div><div className="insight-list"><div><span className="insight-icon good"><TrendingUp size={18} /></span><div><strong>Instagram porte l’acquisition</strong><p>79% du revenu attribué et le plus grand volume qualifié.</p></div></div><div><span className="insight-icon"><Sparkles size={18} /></span><div><strong>Les brouillons IA accélèrent</strong><p>Temps de première réponse réduit de 38% sur les conversations assistées.</p></div></div><div><span className="insight-icon warn"><Target size={18} /></span><div><strong>YouTube reste sous-exploité</strong><p>Bon signal d’intention, mais 18 commentaires n’ont pas encore de suivi CRM.</p></div></div></div></article>
      </section>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Du signal à la vente</span><h2>Conversion détaillée</h2></div><Button variant="secondary">Exporter CSV</Button></div><div className="analytics-table"><div className="analytics-table-row table-header"><span>Canal</span><span>Interactions</span><span>Conversations</span><span>Qualifiés</span><span>CA attribué</span></div>{data.sources.map((source) => <div className="analytics-table-row" key={source.platform}><span><PlatformBadge platform={source.platform} /></span><span>{source.conversations * 7}</span><span>{source.conversations}</span><span>{source.qualified}</span><strong>{source.revenue.toLocaleString('fr-FR')} €</strong></div>)}</div></article>
    </div>
  );
}

function Settings({ notify }: { notify: (text: string) => void }) {
  const [copilot, setCopilot] = useState(true);
  const [approval, setApproval] = useState(true);
  const [tone, setTone] = useState('Chaleureux et professionnel');
  return (
    <div className="page-stack settings-page">
      <section className="page-heading-row"><div><p className="page-kicker">Gouvernance du copilote</p><h1>Paramètres IA</h1><p>Définissez ce que l’IA peut suggérer, sans lui donner plus de pouvoir que nécessaire.</p></div><Button icon={Check} onClick={() => notify('Paramètres enregistrés en mode démonstration.')}>Enregistrer</Button></section>
      <section className="settings-layout"><nav className="settings-nav"><button className="active"><Bot size={17} /> Copilote</button><button><Database size={17} /> Connaissances</button><button><ShieldCheck size={17} /> Sécurité</button><button><UsersRound size={17} /> Équipe</button></nav><div className="settings-content">
        <article className="settings-card"><div className="settings-card-heading"><span className="settings-icon"><Bot size={20} /></span><div><h2>Copilote de réponse</h2><p>Génère des brouillons à partir du contexte de la conversation.</p></div><Toggle checked={copilot} onChange={() => setCopilot(!copilot)} label="Activer le copilote" /></div><div className="settings-fields"><label className="form-field">Ton de la marque<select value={tone} onChange={(event) => setTone(event.target.value)}><option>Chaleureux et professionnel</option><option>Direct et énergique</option><option>Élégant et institutionnel</option></select></label><label className="form-field">Instructions permanentes<textarea rows={4} defaultValue="Tutoyer uniquement si le contact tutoie. Répondre en français. Ne jamais inventer une date, un prix ou une disponibilité. Proposer une seule prochaine action claire." /></label></div></article>
        <article className="settings-card"><div className="settings-card-heading"><span className="settings-icon"><ShieldCheck size={20} /></span><div><h2>Validation humaine</h2><p>Contrôle les cas où un collaborateur doit approuver la réponse.</p></div><Toggle checked={approval} onChange={() => setApproval(!approval)} label="Exiger une validation humaine" /></div><div className="policy-list"><label><input type="checkbox" defaultChecked /> Toujours valider les prix et propositions commerciales</label><label><input type="checkbox" defaultChecked /> Bloquer les promesses de disponibilité non vérifiées</label><label><input type="checkbox" defaultChecked /> Escalader les messages négatifs ou sensibles</label><label><input type="checkbox" /> Autoriser l’envoi automatique des réponses FAQ approuvées</label></div></article>
        <article className="settings-card"><div className="settings-card-heading"><span className="settings-icon"><Database size={20} /></span><div><h2>Base de connaissances</h2><p>Sources utilisées pour créer les brouillons sans hallucination.</p></div><Button variant="secondary" icon={Plus} onClick={() => notify('L’import de documents sera stocké dans R2 lors du branchement live.')}>Ajouter</Button></div><div className="knowledge-list"><div><span className="file-icon">PDF</span><span><strong>Offres & tarifs Neptune 2026</strong><small>24 pages · mis à jour il y a 5 jours</small></span><CheckCircle2 size={18} /></div><div><span className="file-icon">URL</span><span><strong>neptunebusinessclub.com/evenements</strong><small>Synchronisation quotidienne prévue</small></span><Clock3 size={18} /></div></div></article>
      </div></section>
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [data, setData] = useState<BootstrapData>(demoData);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string>();
  const unread = data.conversations.reduce((total, conversation) => total + conversation.unread, 0);

  useEffect(() => {
    let active = true;
    fetch('/api/bootstrap').then((response) => response.ok ? response.json() : Promise.reject()).then((payload: BootstrapData) => active && setData(payload)).catch(() => undefined).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(undefined), 3400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function navigate(next: Page) {
    setPage(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const content = useMemo(() => {
    if (page === 'dashboard') return <Dashboard data={data} navigate={navigate} />;
    if (page === 'connections') return <Connections connections={data.connections} notify={setToast} />;
    if (page === 'inbox') return <Inbox initialConversations={data.conversations} notify={setToast} />;
    if (page === 'automations') return <Automations initialRules={data.automations} notify={setToast} />;
    if (page === 'crm') return <CRM initialLeads={data.leads} notify={setToast} />;
    if (page === 'analytics') return <Analytics data={data} />;
    return <Settings notify={setToast} />;
  }, [page, data]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark"><Command size={20} /></span><span><strong>NEPTUNE</strong><small>Social Conversion</small></span><button className="mobile-close icon-button" onClick={() => setMenuOpen(false)} aria-label="Fermer le menu"><X size={19} /></button></div>
        <div className="workspace-switcher"><span className="workspace-avatar">NB</span><span><strong>Neptune Business</strong><small>Club · France</small></span><ChevronDown size={15} /></div>
        <nav className="main-nav" aria-label="Navigation principale">{navItems.map((item) => <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => navigate(item.id)}><item.icon size={18} /><span>{item.label}</span>{item.id === 'inbox' && unread > 0 && <b>{unread}</b>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="demo-card"><span><Sparkles size={15} /> Mode démonstration</span><p>Toutes les identités et métriques sont fictives. Les contrats Cloudflare sont prêts.</p></div><button><CircleHelp size={18} /> Centre d’aide</button><div className="user-card"><Avatar initials="AN" /><span><strong>Admin Neptune</strong><small>Administrateur</small></span><MoreHorizontal size={17} /></div></div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="Fermer le menu" />}
      <div className="app-main">
        <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu"><Menu size={21} /></button><div className="breadcrumb"><span>Neptune</span><ChevronRight size={14} /><strong>{pageTitles[page]}</strong></div><div className="topbar-actions"><span className="environment-badge"><i /> Démo sécurisée</span><button className="icon-button notification-button" aria-label="Notifications"><Bell size={19} /><i /></button><Avatar initials="AN" /></div></header>
        <main className={page === 'inbox' ? 'content content-inbox' : 'content'}>{loading && <div className="loading-line" />}{content}</main>
      </div>
      {toast && <div className="toast" role="status"><CheckCircle2 size={18} /><span>{toast}</span><button onClick={() => setToast(undefined)} aria-label="Fermer"><X size={16} /></button></div>}
    </div>
  );
}

export default App;
