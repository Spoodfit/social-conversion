import { useMemo } from 'react';
import {
  Check,
  ChevronDown,
  Globe2,
  Image as ImageIcon,
  Link2,
  MapPin,
  MessageCircle,
  Settings2,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';
import PlannerComposerPreview from './PlannerComposerPreview';
import {
  defaultPublicationFields,
  getPublicationFormat,
  publicationPlatformSchemas,
  type PlanningPlatform,
} from './shared/social-publication-fields';
import type { DestinationDraft } from './PlatformDestinationEditor';

type ComposerMedia = {
  mimeType: string;
  previewUrl: string;
  title: string;
  format: 'post' | 'short' | 'video' | 'story';
};

type WriterObjective = 'engagement' | 'conversion';

type Props = {
  draft: DestinationDraft;
  media?: ComposerMedia;
  fallbackText?: string;
  aiReady: boolean;
  writerObjective: WriterObjective;
  writerBusy: boolean;
  writerError?: string;
  onWriterObjective: (objective: WriterObjective) => void;
  onGenerate: () => void;
  onDraft: (key: string, draft: DestinationDraft) => void;
};

const platformNames: Record<PlanningPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

function platformGlyph(platform: PlanningPlatform) {
  if (platform === 'facebook') return 'f';
  if (platform === 'instagram') return '◎';
  if (platform === 'linkedin') return 'in';
  if (platform === 'youtube') return '▶';
  return '♪';
}

function cleanAccountLabel(label: string, platform: PlanningPlatform) {
  const prefix = `${platformNames[platform]} · `;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

function initials(value: string) {
  const words = value.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'N';
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1]?.[0] ?? '' : '')).toUpperCase();
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function boolValue(value: unknown) {
  return value === true;
}

function tagsValue(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').join(', ') : textValue(value);
}

function NativeIdentity({ draft }: { draft: DestinationDraft }) {
  const name = cleanAccountLabel(draft.accountLabel, draft.platform);
  return (
    <div className={`npc-identity npc-${draft.platform}`}>
      <span className="npc-avatar">{initials(name)}</span>
      <span className="npc-identity-copy">
        <strong>{name}</strong>
        <small>{draft.accountHandle || `${platformNames[draft.platform]} connecté`}</small>
      </span>
      <span className="npc-platform-badge"><b>{platformGlyph(draft.platform)}</b>{platformNames[draft.platform]}</span>
    </div>
  );
}

function MediaSummary({ media }: { media?: ComposerMedia }) {
  if (!media) {
    return <div className="npc-media-empty"><ImageIcon size={18} /><span><strong>Aucun média</strong><small>Le post peut rester textuel si le réseau l’autorise.</small></span></div>;
  }
  return (
    <div className="npc-media-summary">
      <span className="npc-media-thumb">
        {media.mimeType.startsWith('image/') ? <img src={media.previewUrl} alt="" /> : <><video src={media.previewUrl} muted playsInline preload="metadata" /><Video size={16} /></>}
      </span>
      <span><strong>{media.title}</strong><small>{media.mimeType.startsWith('video/') ? 'Vidéo sélectionnée' : 'Image sélectionnée'}</small></span>
    </div>
  );
}

function CharacterCount({ value, max }: { value: string; max: number }) {
  return <small className={value.length > max * 0.9 ? 'npc-count warning' : 'npc-count'}>{value.length}/{max}</small>;
}

function ToggleRow({ checked, label, help, onChange }: { checked: boolean; label: string; help?: string; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" className={`npc-toggle-row${checked ? ' active' : ''}`} onClick={() => onChange(!checked)}>
      <span><strong>{label}</strong>{help && <small>{help}</small>}</span>
      <i>{checked && <Check size={12} />}</i>
    </button>
  );
}

function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="npc-details">
      <summary><Settings2 size={14} /><span>{title}</span><ChevronDown size={14} /></summary>
      <div>{children}</div>
    </details>
  );
}

function AiInline({ ready, objective, busy, error, onObjective, onGenerate }: {
  ready: boolean;
  objective: WriterObjective;
  busy: boolean;
  error?: string;
  onObjective: (objective: WriterObjective) => void;
  onGenerate: () => void;
}) {
  return (
    <section className="npc-ai">
      <header><Sparkles size={15} /><span><strong>Assistant rédaction</strong><small>Optionnel · adapte le texte au réseau sélectionné.</small></span></header>
      <div className="npc-ai-actions">
        <button type="button" className={objective === 'engagement' ? 'active' : ''} onClick={() => onObjective('engagement')}>💬 Engagement</button>
        <button type="button" className={objective === 'conversion' ? 'active' : ''} onClick={() => onObjective('conversion')}>🎯 Conversion</button>
        <button type="button" className="generate" disabled={!ready || busy} onClick={onGenerate}><Sparkles size={13} /> {busy ? 'Rédaction…' : 'Générer'}</button>
      </div>
      {!ready && <small className="npc-ai-note">Assistant indisponible sur cet environnement.</small>}
      {error && <small className="npc-ai-error">{error}</small>}
    </section>
  );
}

function FormatSwitcher({ draft, onChange }: { draft: DestinationDraft; onChange: (format: string) => void }) {
  const formats = publicationPlatformSchemas[draft.platform].formats;
  if (formats.length <= 1) return null;
  return (
    <div className="npc-format-switcher">
      <span>Format</span>
      <div>{formats.map((format) => <button type="button" key={format.id} className={draft.format === format.id ? 'active' : ''} onClick={() => onChange(format.id)}>{format.label}</button>)}</div>
    </div>
  );
}

function LinkedInEditor({ draft, media, setField }: { draft: DestinationDraft; media?: ComposerMedia; setField: (key: string, value: unknown) => void }) {
  const commentary = textValue(draft.fields.commentary);
  const visibility = textValue(draft.fields.visibility) || 'PUBLIC';
  return (
    <div className="npc-native-editor linkedin">
      <NativeIdentity draft={draft} />
      <label className="npc-main-copy linkedin-copy">
        <textarea value={commentary} maxLength={3000} onChange={(event) => setField('commentary', event.target.value)} placeholder="De quoi souhaitez-vous parler ?" />
        <CharacterCount value={commentary} max={3000} />
      </label>
      <div className="npc-inline-tools"><span><ImageIcon size={14} /> Photo</span><span><Video size={14} /> Vidéo</span><span><Link2 size={14} /> Lien dans le texte</span></div>
      <MediaSummary media={media} />
      <div className="npc-section-label"><Globe2 size={14} /><span><strong>Qui peut voir cette publication ?</strong><small>Comme dans LinkedIn, choisissez l’audience avant publication.</small></span></div>
      <div className="npc-segmented two">
        <button type="button" className={visibility === 'PUBLIC' ? 'active' : ''} onClick={() => setField('visibility', 'PUBLIC')}><Globe2 size={14} /> Tout le monde</button>
        <button type="button" className={visibility === 'CONNECTIONS' ? 'active' : ''} onClick={() => setField('visibility', 'CONNECTIONS')}><Users size={14} /> Relations uniquement</button>
      </div>
      {media?.mimeType.startsWith('image/') && <Details title="Accessibilité"><label className="npc-field"><span>Texte alternatif de l’image</span><textarea value={textValue(draft.fields.altText)} maxLength={4000} onChange={(event) => setField('altText', event.target.value)} placeholder="Décrivez ce que contient l’image…" /><small>Ce texte aide les personnes utilisant un lecteur d’écran.</small></label></Details>}
    </div>
  );
}

function FacebookEditor({ draft, media, setField }: { draft: DestinationDraft; media?: ComposerMedia; setField: (key: string, value: unknown) => void }) {
  const message = textValue(draft.fields.message);
  return (
    <div className="npc-native-editor facebook">
      <div className="npc-network-title"><span className="npc-fb-icon">f</span><span><strong>Créer une publication</strong><small>Page Facebook</small></span></div>
      <NativeIdentity draft={draft} />
      <label className="npc-main-copy facebook-copy">
        <textarea value={message} maxLength={5000} onChange={(event) => setField('message', event.target.value)} placeholder="Quoi de neuf ?" />
        <CharacterCount value={message} max={5000} />
      </label>
      <div className="npc-facebook-add"><span>Ajouter à votre publication</span><div><button type="button"><ImageIcon size={15} /> Photo</button><button type="button"><Video size={15} /> Vidéo</button><button type="button"><Link2 size={15} /> Lien</button></div></div>
      <MediaSummary media={media} />
      <div className="npc-static-audience"><Globe2 size={14} /><span><strong>Public</strong><small>La publication sera envoyée sur la Page sélectionnée.</small></span></div>
    </div>
  );
}

function InstagramEditor({ draft, media, setField }: { draft: DestinationDraft; media?: ComposerMedia; setField: (key: string, value: unknown) => void }) {
  const caption = textValue(draft.fields.caption);
  const story = draft.format === 'story';
  return (
    <div className="npc-native-editor instagram">
      <NativeIdentity draft={draft} />
      {story ? (
        <>
          <div className="npc-story-note"><strong>Story Instagram</strong><small>Le média sera publié en plein écran vertical. Les stickers interactifs restent à ajouter directement dans Instagram s’ils ne sont pas pris en charge par l’API.</small></div>
          <MediaSummary media={media} />
          <Details title="Note interne"><label className="npc-field"><span>Note de préparation</span><textarea value={textValue(draft.fields.note)} onChange={(event) => setField('note', event.target.value)} placeholder="Ex. ajouter un sticker sondage dans Instagram…" /></label></Details>
        </>
      ) : (
        <>
          <label className="npc-main-copy instagram-copy"><textarea value={caption} maxLength={2200} onChange={(event) => setField('caption', event.target.value)} placeholder={draft.format === 'reel' ? 'Écrivez la légende du Reel…' : 'Écrivez une légende…'} /><CharacterCount value={caption} max={2200} /></label>
          <MediaSummary media={media} />
          {draft.format !== 'reel' && <label className="npc-icon-field"><MapPin size={15} /><input value={textValue(draft.fields.location)} maxLength={180} onChange={(event) => setField('location', event.target.value)} placeholder="Ajouter un lieu" /></label>}
          {draft.format === 'reel' && <ToggleRow checked={boolValue(draft.fields.shareToFeed)} label="Partager aussi dans le fil" help="Affiche également le Reel dans votre grille." onChange={(value) => setField('shareToFeed', value)} />}
          {draft.format !== 'reel' && <Details title="Accessibilité"><label className="npc-field"><span>Texte alternatif</span><textarea value={textValue(draft.fields.altText)} maxLength={1000} onChange={(event) => setField('altText', event.target.value)} placeholder="Décrivez le visuel…" /></label></Details>}
        </>
      )}
    </div>
  );
}

function TikTokEditor({ draft, media, setField }: { draft: DestinationDraft; media?: ComposerMedia; setField: (key: string, value: unknown) => void }) {
  const primary = textValue(draft.fields.title);
  const isPhoto = draft.format === 'photo';
  const privacy = textValue(draft.fields.privacyLevel);
  return (
    <div className="npc-native-editor tiktok">
      <NativeIdentity draft={draft} />
      <label className="npc-main-copy tiktok-copy"><textarea value={primary} maxLength={isPhoto ? 90 : 2200} onChange={(event) => setField('title', event.target.value)} placeholder={isPhoto ? 'Ajouter un titre…' : 'Décrivez votre vidéo… #hashtags @mentions'} /><CharacterCount value={primary} max={isPhoto ? 90 : 2200} /></label>
      {isPhoto && <label className="npc-field"><span>Description</span><textarea value={textValue(draft.fields.description)} maxLength={4000} onChange={(event) => setField('description', event.target.value)} placeholder="Ajoutez plus de contexte…" /></label>}
      <MediaSummary media={media} />
      <label className="npc-select-field"><span><Globe2 size={14} /> Qui peut voir cette publication ?</span><select value={privacy} onChange={(event) => setField('privacyLevel', event.target.value)}><option value="">Choisir avant publication</option><option value="PUBLIC_TO_EVERYONE">Tout le monde</option><option value="MUTUAL_FOLLOW_FRIENDS">Amis mutuels</option><option value="FOLLOWER_OF_CREATOR">Abonnés</option><option value="SELF_ONLY">Moi uniquement</option></select></label>
      <div className="npc-toggle-stack">
        <ToggleRow checked={boolValue(draft.fields.allowComments)} label="Autoriser les commentaires" onChange={(value) => setField('allowComments', value)} />
        {!isPhoto && <ToggleRow checked={boolValue(draft.fields.allowDuet)} label="Autoriser Duet" onChange={(value) => setField('allowDuet', value)} />}
        {!isPhoto && <ToggleRow checked={boolValue(draft.fields.allowStitch)} label="Autoriser Stitch" onChange={(value) => setField('allowStitch', value)} />}
        {isPhoto && <ToggleRow checked={boolValue(draft.fields.autoAddMusic)} label="Ajouter automatiquement une musique" onChange={(value) => setField('autoAddMusic', value)} />}
        {isPhoto && <ToggleRow checked={boolValue(draft.fields.brandContent)} label="Contenu de marque / partenariat rémunéré" onChange={(value) => setField('brandContent', value)} />}
      </div>
      {!isPhoto && <Details title="Couverture"><label className="npc-field"><span>Position de la couverture (ms)</span><input type="number" min={0} step={1000} value={typeof draft.fields.coverTimestampMs === 'number' ? draft.fields.coverTimestampMs : ''} onChange={(event) => setField('coverTimestampMs', event.target.value === '' ? '' : Number(event.target.value))} /><small>Choisissez l’instant de la vidéo utilisé pour la couverture.</small></label></Details>}
    </div>
  );
}

function YouTubeEditor({ draft, media, setField }: { draft: DestinationDraft; media?: ComposerMedia; setField: (key: string, value: unknown) => void }) {
  const title = textValue(draft.fields.title);
  const madeForKids = typeof draft.fields.madeForKids === 'boolean' ? draft.fields.madeForKids : undefined;
  return (
    <div className="npc-native-editor youtube">
      <div className="npc-network-title youtube"><span className="npc-youtube-icon">▶</span><span><strong>Détails de la vidéo</strong><small>YouTube Studio</small></span></div>
      <NativeIdentity draft={draft} />
      <label className="npc-field prominent"><span>Titre <b>Requis</b></span><input value={title} maxLength={100} onChange={(event) => setField('title', event.target.value)} placeholder={draft.format === 'short' ? 'Titre du Short' : 'Titre de la vidéo'} /><CharacterCount value={title} max={100} /></label>
      <label className="npc-field"><span>Description</span><textarea value={textValue(draft.fields.description)} maxLength={5000} onChange={(event) => setField('description', event.target.value)} placeholder="Présentez votre contenu, ajoutez vos liens et informations utiles…" /></label>
      <MediaSummary media={media} />
      <label className="npc-select-field"><span>Visibilité</span><select value={textValue(draft.fields.privacyStatus) || 'private'} onChange={(event) => setField('privacyStatus', event.target.value)}><option value="private">Privée</option><option value="unlisted">Non répertoriée</option><option value="public">Publique</option></select></label>
      <fieldset className="npc-audience-choice"><legend>Cette vidéo est-elle conçue pour les enfants ? <b>Requis</b></legend><div><button type="button" className={madeForKids === true ? 'active' : ''} onClick={() => setField('madeForKids', true)}>{madeForKids === true && <Check size={13} />} Oui</button><button type="button" className={madeForKids === false ? 'active' : ''} onClick={() => setField('madeForKids', false)}>{madeForKids === false && <Check size={13} />} Non</button></div></fieldset>
      <Details title="Plus d’options">
        <label className="npc-field"><span>Tags</span><input value={tagsValue(draft.fields.tags)} onChange={(event) => setField('tags', event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean))} placeholder="entrepreneuriat, business, réseau" /></label>
        {draft.format === 'video' && <label className="npc-field"><span>Catégorie</span><input value={textValue(draft.fields.categoryId)} maxLength={10} onChange={(event) => setField('categoryId', event.target.value)} placeholder="Ex. 22" /></label>}
        <ToggleRow checked={boolValue(draft.fields.containsSyntheticMedia)} label="Contient du média synthétique réaliste" onChange={(value) => setField('containsSyntheticMedia', value)} />
        {draft.format === 'video' && <ToggleRow checked={draft.fields.embeddable !== false} label="Autoriser l’intégration sur d’autres sites" onChange={(value) => setField('embeddable', value)} />}
        {draft.format === 'video' && 'notifySubscribers' in draft.fields && <ToggleRow checked={draft.fields.notifySubscribers !== false} label="Notifier les abonnés" onChange={(value) => setField('notifySubscribers', value)} />}
      </Details>
    </div>
  );
}

export default function NativePlatformComposer({
  draft,
  media,
  fallbackText = '',
  aiReady,
  writerObjective,
  writerBusy,
  writerError,
  onWriterObjective,
  onGenerate,
  onDraft,
}: Props) {
  const schema = publicationPlatformSchemas[draft.platform];
  const formatDefinition = getPublicationFormat(draft.platform, draft.format);

  const previewDestination = useMemo(() => ({
    platform: draft.platform,
    accountLabel: draft.accountLabel,
    accountHandle: draft.accountHandle,
    format: draft.format,
    fields: draft.fields,
  }), [draft]);

  const setField = (key: string, value: unknown) => {
    onDraft(draft.key, { ...draft, fields: { ...draft.fields, [key]: value } });
  };

  const setFormat = (format: string) => {
    const nextDefinition = getPublicationFormat(draft.platform, format);
    const defaults = defaultPublicationFields(draft.platform, format);
    const fields: Record<string, unknown> = { ...defaults };
    for (const field of nextDefinition.fields) {
      if (draft.fields[field.key] !== undefined) fields[field.key] = draft.fields[field.key];
    }
    if (draft.platform === 'tiktok' && format === 'photo' && !fields.title) fields.title = textValue(draft.fields.title);
    onDraft(draft.key, { ...draft, format, fields });
  };

  return (
    <section className={`npc-shell npc-shell-${draft.platform}`}>
      <header className="npc-header">
        <div>
          <small>PUBLICATION {platformNames[draft.platform].toUpperCase()}</small>
          <h3>Créez votre publication comme sur {platformNames[draft.platform]}</h3>
          <p>Ce que vous modifiez à gauche est reflété immédiatement dans l’aperçu final.</p>
        </div>
        <span className={`npc-network-chip ${draft.platform}`}><b>{platformGlyph(draft.platform)}</b>{platformNames[draft.platform]}</span>
      </header>

      <FormatSwitcher draft={draft} onChange={setFormat} />
      <div className="npc-format-hint">{formatDefinition.mediaHint}</div>

      <div className="npc-workspace">
        <div className="npc-editor-column">
          {draft.platform === 'linkedin' && <LinkedInEditor draft={draft} media={media} setField={setField} />}
          {draft.platform === 'facebook' && <FacebookEditor draft={draft} media={media} setField={setField} />}
          {draft.platform === 'instagram' && <InstagramEditor draft={draft} media={media} setField={setField} />}
          {draft.platform === 'tiktok' && <TikTokEditor draft={draft} media={media} setField={setField} />}
          {draft.platform === 'youtube' && <YouTubeEditor draft={draft} media={media} setField={setField} />}
          <AiInline ready={aiReady} objective={writerObjective} busy={writerBusy} error={writerError} onObjective={onWriterObjective} onGenerate={onGenerate} />
        </div>

        <aside className="npc-preview-column">
          <div className="npc-preview-heading"><span><strong>Aperçu en direct</strong><small>Le rendu suit le format sélectionné.</small></span><Globe2 size={15} /></div>
          <PlannerComposerPreview
            destinations={[previewDestination]}
            activeIndex={0}
            onActiveIndex={() => undefined}
            media={media}
            fallbackText={fallbackText}
          />
        </aside>
      </div>
    </section>
  );
}
