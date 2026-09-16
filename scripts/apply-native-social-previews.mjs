import fs from 'node:fs';

const fieldsPath = 'src/shared/social-publication-fields.ts';
const fields = fs.readFileSync(fieldsPath, 'utf8');
for (const platform of ['facebook', 'instagram', 'linkedin', 'youtube', 'tiktok']) {
  if (!fields.includes(`'${platform}'`)) throw new Error(`Native preview patch requires ${platform} in PlanningPlatform.`);
}

const preview = String.raw`import { useState } from 'react';

export type ComposerPreviewDestination = {
  platform: 'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'tiktok';
  accountLabel: string;
  accountHandle?: string;
  format: string;
  fields: Record<string, unknown>;
};

type PreviewMedia = {
  mimeType: string;
  previewUrl: string;
  title: string;
  format: 'post' | 'short' | 'video' | 'story';
};

type DeviceMode = 'mobile' | 'desktop';

function fieldText(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function platformLabel(platform: ComposerPreviewDestination['platform']) {
  if (platform === 'facebook') return 'Facebook';
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'linkedin') return 'LinkedIn';
  if (platform === 'youtube') return 'YouTube';
  return 'TikTok';
}

function brandGlyph(platform: ComposerPreviewDestination['platform']) {
  if (platform === 'facebook') return 'f';
  if (platform === 'instagram') return '◎';
  if (platform === 'linkedin') return 'in';
  if (platform === 'youtube') return '▶';
  return '♪';
}

function cleanAccountLabel(label: string, platform: ComposerPreviewDestination['platform']) {
  const prefix = platformLabel(platform) + ' · ';
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

function accountHandle(destination: ComposerPreviewDestination) {
  const value = destination.accountHandle || cleanAccountLabel(destination.accountLabel, destination.platform);
  return value.replace(/^@/, '');
}

function copyFor(destination: ComposerPreviewDestination, fallbackText: string) {
  if (destination.platform === 'facebook') return fieldText(destination.fields, ['message']) || fallbackText;
  if (destination.platform === 'linkedin') return fieldText(destination.fields, ['commentary']) || fallbackText;
  if (destination.platform === 'youtube') return fieldText(destination.fields, ['title', 'description']) || fallbackText;
  if (destination.platform === 'tiktok') return fieldText(destination.fields, ['title', 'description']) || fallbackText;
  return fieldText(destination.fields, ['caption', 'note']) || fallbackText;
}

function initials(label: string) {
  const words = label.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] || 'N';
  const second = words.length > 1 ? words[words.length - 1]?.[0] || '' : '';
  return (first + second).toUpperCase();
}

function TruncatedCopy({ text, limit = 300 }: { text: string; limit?: number }) {
  const trimmed = text.trim();
  if (!trimmed) return <span className="nsp-placeholder-copy">Votre texte apparaîtra ici.</span>;
  if (trimmed.length <= limit) return <>{trimmed}</>;
  return <>{trimmed.slice(0, limit).trimEnd()}… <strong className="nsp-see-more">voir plus</strong></>;
}

function MediaSurface({ media, mode = 'fit', required = false, carousel = false }: {
  media?: PreviewMedia;
  mode?: 'fit' | 'cover';
  required?: boolean;
  carousel?: boolean;
}) {
  if (!media) {
    if (!required) return null;
    return <div className="nsp-media nsp-media-empty"><span>＋</span><strong>Média requis</strong><small>Ajoutez le contenu pour voir le cadrage réel.</small></div>;
  }
  const className = 'nsp-media ' + (mode === 'cover' ? 'is-cover' : 'is-fit');
  return (
    <div className={className}>
      {media.mimeType.startsWith('image/')
        ? <img src={media.previewUrl} alt={media.title} />
        : media.mimeType.startsWith('video/')
          ? <><video src={media.previewUrl} muted playsInline preload="metadata" /><span className="nsp-play">▶</span></>
          : <div className="nsp-media-empty"><strong>Aperçu indisponible</strong></div>}
      {carousel && <span className="nsp-carousel-index">1/2</span>}
    </div>
  );
}

function validationFor(destination: ComposerPreviewDestination, media: PreviewMedia | undefined, copy: string) {
  const warnings: string[] = [];
  const isImage = Boolean(media?.mimeType.startsWith('image/'));
  const isVideo = Boolean(media?.mimeType.startsWith('video/'));
  if (!copy.trim() && !media) warnings.push('Ajoutez du texte ou un média.');
  if (destination.platform === 'linkedin') {
    if (copy.length > 3000) warnings.push('Le texte LinkedIn dépasse 3 000 caractères.');
    if (isVideo) warnings.push('Le connecteur LinkedIn actuel publie texte + image, pas encore la vidéo.');
  }
  if (destination.platform === 'facebook' && isVideo) warnings.push('Le connecteur Facebook actuel publie texte + image.');
  if (destination.platform === 'instagram') {
    if ((destination.format === 'post' || destination.format === 'carousel') && !media) warnings.push('Instagram Feed nécessite un média.');
    if ((destination.format === 'reel' || destination.format === 'story') && !isVideo) warnings.push('Utilisez une vidéo verticale pour ce format.');
  }
  if (destination.platform === 'tiktok') {
    if (destination.format === 'video' && !isVideo) warnings.push('TikTok vidéo nécessite une vidéo.');
    if (destination.format === 'photo' && !isImage) warnings.push('TikTok Photos nécessite une image.');
  }
  if (destination.platform === 'youtube') {
    if (!isVideo) warnings.push('YouTube nécessite un fichier vidéo pour ce format.');
    const title = fieldText(destination.fields, ['title']);
    if (!title.trim()) warnings.push('Ajoutez un titre YouTube.');
  }
  return warnings;
}

function ProfileAvatar({ destination }: { destination: ComposerPreviewDestination }) {
  const label = cleanAccountLabel(destination.accountLabel, destination.platform);
  return <span className={'nsp-avatar nsp-avatar-' + destination.platform}>{initials(label)}</span>;
}

function LinkedInPreview({ destination, media, copy, device }: {
  destination: ComposerPreviewDestination;
  media?: PreviewMedia;
  copy: string;
  device: DeviceMode;
}) {
  const name = cleanAccountLabel(destination.accountLabel, 'linkedin');
  return (
    <article className={'nsp-card nsp-linkedin ' + device}>
      <header className="nsp-post-head">
        <ProfileAvatar destination={destination} />
        <div><strong>{name}</strong><small>{destination.accountHandle || 'Profil personnel'} · 1 min</small><small>🌐</small></div>
        <b>•••</b>
      </header>
      <div className="nsp-copy linkedin-copy"><TruncatedCopy text={copy} limit={260} /></div>
      <MediaSurface media={media} mode="fit" />
      <div className="nsp-linkedin-counts"><span>👍 ❤️</span><small>0 commentaire · 0 republication</small></div>
      <div className="nsp-actions four"><span>♡ <b>J’aime</b></span><span>◯ <b>Commenter</b></span><span>↻ <b>Republier</b></span><span>➤ <b>Envoyer</b></span></div>
    </article>
  );
}

function FacebookPreview({ destination, media, copy, device }: {
  destination: ComposerPreviewDestination;
  media?: PreviewMedia;
  copy: string;
  device: DeviceMode;
}) {
  const name = cleanAccountLabel(destination.accountLabel, 'facebook');
  return (
    <article className={'nsp-card nsp-facebook ' + device}>
      <header className="nsp-post-head"><ProfileAvatar destination={destination} /><div><strong>{name}</strong><small>À l’instant · 🌐</small></div><b>•••</b></header>
      <div className="nsp-copy facebook-copy"><TruncatedCopy text={copy} limit={300} /></div>
      <MediaSurface media={media} mode="cover" />
      <div className="nsp-facebook-counts"><span>👍 ❤️ 0</span><small>0 commentaire · 0 partage</small></div>
      <div className="nsp-actions three"><span>♡ <b>J’aime</b></span><span>◯ <b>Commenter</b></span><span>↗ <b>Partager</b></span></div>
    </article>
  );
}

function InstagramFeedPreview({ destination, media, copy, carousel }: {
  destination: ComposerPreviewDestination;
  media?: PreviewMedia;
  copy: string;
  carousel?: boolean;
}) {
  const handle = accountHandle(destination);
  return (
    <article className="nsp-card nsp-instagram-feed mobile">
      <header className="nsp-post-head"><ProfileAvatar destination={destination} /><div><strong>{handle}</strong>{fieldText(destination.fields, ['location']) && <small>{fieldText(destination.fields, ['location'])}</small>}</div><b>•••</b></header>
      <MediaSurface media={media} mode="cover" required carousel={carousel} />
      <div className="nsp-instagram-actions"><span>♡</span><span>◯</span><span>➤</span><span className="push">⌑</span></div>
      <div className="nsp-instagram-likes">0 J’aime</div>
      <div className="nsp-copy instagram-copy"><strong>{handle}</strong> <TruncatedCopy text={copy} limit={180} /></div>
      <div className="nsp-muted-line">Voir les 0 commentaires</div>
    </article>
  );
}

function InstagramVerticalPreview({ destination, media, copy, story }: {
  destination: ComposerPreviewDestination;
  media?: PreviewMedia;
  copy: string;
  story?: boolean;
}) {
  const handle = accountHandle(destination);
  return (
    <article className={'nsp-vertical nsp-instagram-vertical ' + (story ? 'story' : 'reel')}>
      <MediaSurface media={media} mode="cover" required />
      <div className="nsp-vertical-shade" />
      {story ? (
        <><div className="nsp-story-progress"><i /><i /><i /></div><header><ProfileAvatar destination={destination} /><strong>{handle}</strong><small>1 min</small><span>•••</span></header><div className="nsp-story-reply">Envoyer un message… ♡ ➤</div></>
      ) : (
        <><div className="nsp-vertical-bottom"><strong>{handle}</strong><p><TruncatedCopy text={copy} limit={120} /></p><small>♫ Audio original</small></div><div className="nsp-vertical-actions"><span>♡<small>0</small></span><span>◯<small>0</small></span><span>➤<small>0</small></span><span>⌑</span></div></>
      )}
    </article>
  );
}

function TikTokPreview({ destination, media, copy }: {
  destination: ComposerPreviewDestination;
  media?: PreviewMedia;
  copy: string;
}) {
  const handle = accountHandle(destination);
  return (
    <article className="nsp-vertical nsp-tiktok">
      <MediaSurface media={media} mode="cover" required />
      <div className="nsp-vertical-shade" />
      <div className="nsp-tiktok-top"><strong>Abonnements</strong><strong>Pour toi</strong></div>
      <div className="nsp-vertical-bottom"><strong>@{handle}</strong><p><TruncatedCopy text={copy} limit={130} /></p><small>♫ son original · {handle}</small></div>
      <div className="nsp-vertical-actions"><ProfileAvatar destination={destination} /><span>♥<small>0</small></span><span>●<small>0</small></span><span>↗<small>0</small></span><span>◉</span></div>
    </article>
  );
}

function YouTubePreview({ destination, media, device, short }: {
  destination: ComposerPreviewDestination;
  media?: PreviewMedia;
  device: DeviceMode;
  short?: boolean;
}) {
  const title = fieldText(destination.fields, ['title']) || 'Titre de la vidéo';
  const description = fieldText(destination.fields, ['description']);
  const channel = cleanAccountLabel(destination.accountLabel, 'youtube');
  if (short) {
    return (
      <article className="nsp-vertical nsp-youtube-short">
        <MediaSurface media={media} mode="cover" required />
        <div className="nsp-vertical-shade" />
        <div className="nsp-vertical-bottom"><strong>@{accountHandle(destination)}</strong><p><TruncatedCopy text={title} limit={100} /></p><small>♫ Son original</small></div>
        <div className="nsp-vertical-actions"><span>♥<small>0</small></span><span>●<small>0</small></span><span>↗<small>Partager</small></span><span>⋮</span></div>
      </article>
    );
  }
  return (
    <article className={'nsp-card nsp-youtube ' + device}>
      <div className="nsp-youtube-player"><MediaSurface media={media} mode="fit" required /><div className="nsp-youtube-controls"><span>▶</span><i /><small>0:00 / 0:00</small><span>⚙ ⛶</span></div></div>
      <h3>{title}</h3>
      <div className="nsp-youtube-channel"><ProfileAvatar destination={destination} /><div><strong>{channel}</strong><small>0 abonné</small></div><button>S’abonner</button></div>
      <div className="nsp-youtube-actions"><span>👍 0</span><span>👎</span><span>↗ Partager</span><span>⋯</span></div>
      {description && <div className="nsp-youtube-description"><strong>À l’instant</strong><p><TruncatedCopy text={description} limit={220} /></p></div>}
    </article>
  );
}

function NetworkPreview({ destination, media, fallbackText, device }: {
  destination: ComposerPreviewDestination;
  media?: PreviewMedia;
  fallbackText: string;
  device: DeviceMode;
}) {
  const copy = copyFor(destination, fallbackText);
  if (destination.platform === 'linkedin') return <LinkedInPreview destination={destination} media={media} copy={copy} device={device} />;
  if (destination.platform === 'facebook') return <FacebookPreview destination={destination} media={media} copy={copy} device={device} />;
  if (destination.platform === 'instagram') {
    if (destination.format === 'story') return <InstagramVerticalPreview destination={destination} media={media} copy={copy} story />;
    if (destination.format === 'reel') return <InstagramVerticalPreview destination={destination} media={media} copy={copy} />;
    return <InstagramFeedPreview destination={destination} media={media} copy={copy} carousel={destination.format === 'carousel'} />;
  }
  if (destination.platform === 'tiktok') return <TikTokPreview destination={destination} media={media} copy={copy} />;
  return <YouTubePreview destination={destination} media={media} device={device} short={destination.format === 'short'} />;
}

export default function PlannerComposerPreview({
  destinations,
  activeIndex,
  onActiveIndex,
  media,
  fallbackText,
}: {
  destinations: ComposerPreviewDestination[];
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  media?: PreviewMedia;
  fallbackText: string;
}) {
  const [device, setDevice] = useState<DeviceMode>('mobile');
  if (!destinations.length) {
    return (
      <section className="nsp-shell is-empty">
        <div className="nsp-heading"><div><small>APERÇU</small><strong>Ce que votre audience verra</strong></div></div>
        <div className="nsp-empty"><span>＋</span><strong>Choisissez au moins un réseau</strong><small>L’aperçu reprend ensuite le format, le cadrage et la structure propres à chaque plateforme.</small></div>
      </section>
    );
  }

  const index = Math.min(Math.max(activeIndex, 0), destinations.length - 1);
  const destination = destinations[index]!;
  const copy = copyFor(destination, fallbackText);
  const warnings = validationFor(destination, media, copy);
  const canDesktop = destination.platform === 'linkedin' || destination.platform === 'facebook' || (destination.platform === 'youtube' && destination.format !== 'short');

  return (
    <section className="nsp-shell">
      <div className="nsp-heading">
        <div><small>APERÇU</small><strong>Ce que votre audience verra</strong><span>Le rendu s’adapte au réseau et au format sélectionnés.</span></div>
        <div className="nsp-heading-tools">
          {canDesktop && <div className="nsp-device-toggle"><button type="button" className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')}>Mobile</button><button type="button" className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')}>Bureau</button></div>}
          <span className={'nsp-readiness ' + (warnings.length ? 'warn' : 'ready')}>{warnings.length ? warnings.length + ' point' + (warnings.length > 1 ? 's' : '') + ' à vérifier' : 'Prêt'}</span>
        </div>
      </div>

      <div className="nsp-tabs">
        {destinations.map((item, itemIndex) => (
          <button type="button" key={item.platform + '-' + item.accountLabel + '-' + itemIndex} className={itemIndex === index ? 'active ' + item.platform : item.platform} onClick={() => onActiveIndex(itemIndex)}>
            <span className={'nsp-brand nsp-brand-' + item.platform}>{brandGlyph(item.platform)}</span>
            <span><strong>{platformLabel(item.platform)}</strong><small>{cleanAccountLabel(item.accountLabel, item.platform)}</small></span>
          </button>
        ))}
      </div>

      {warnings.length > 0 && <div className="nsp-warning-box"><strong>Avant publication</strong>{warnings.map((warning) => <span key={warning}>• {warning}</span>)}</div>}

      <div className={'nsp-stage nsp-stage-' + destination.platform + ' device-' + device}>
        <NetworkPreview destination={destination} media={media} fallbackText={fallbackText} device={device} />
      </div>
      <div className="nsp-footnote">Aperçu de contrôle : le réseau peut faire évoluer de légers détails d’interface sans modifier le contenu publié.</div>
    </section>
  );
}

// SC_NATIVE_SOCIAL_PREVIEWS_V1
`;

fs.writeFileSync('src/PlannerComposerPreview.tsx', preview);
console.log('Native network-aware social previews applied for Facebook, Instagram, LinkedIn, TikTok and YouTube.');
