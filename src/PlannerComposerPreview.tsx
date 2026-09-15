import { Camera, Music2, Video } from 'lucide-react';

export type ComposerPreviewDestination = {
  platform: 'instagram' | 'youtube' | 'tiktok';
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

function fieldText(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function platformLabel(platform: ComposerPreviewDestination['platform']) {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  return 'TikTok';
}

function PlatformIcon({ platform }: { platform: ComposerPreviewDestination['platform'] }) {
  if (platform === 'instagram') return <Camera size={14} />;
  if (platform === 'youtube') return <Video size={14} />;
  return <Music2 size={14} />;
}

function Media({ media, destination }: { media?: PreviewMedia; destination: ComposerPreviewDestination }) {
  if (!media) return <div className="sc6-preview-empty">Aucun média sélectionné</div>;
  const className = `sc6-preview-media sc6-preview-${destination.platform}-${destination.format}`;
  if (media.mimeType.startsWith('image/')) return <div className={className}><img src={media.previewUrl} alt={media.title} /></div>;
  if (media.mimeType.startsWith('video/')) return <div className={className}><video src={media.previewUrl} muted playsInline preload="metadata" /></div>;
  return <div className={`${className} sc6-preview-empty`}>Aperçu indisponible</div>;
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
  if (!destinations.length) {
    return (
      <section className="sc6-final-preview is-empty">
        <div className="sc6-preview-heading"><strong>Aperçu final</strong><small>Sélectionnez d’abord un réseau.</small></div>
        <div className="sc6-preview-placeholder"><span>1</span><strong>Choisissez un contenu</strong><small>Puis sélectionnez Instagram, YouTube ou TikTok.</small></div>
      </section>
    );
  }

  const index = Math.min(Math.max(activeIndex, 0), destinations.length - 1);
  const destination = destinations[index]!;
  const handle = destination.accountHandle || destination.accountLabel;
  const copy = destination.platform === 'youtube'
    ? fieldText(destination.fields, ['title', 'description']) || fallbackText
    : destination.platform === 'tiktok'
      ? fieldText(destination.fields, ['title', 'description']) || fallbackText
      : fieldText(destination.fields, ['caption', 'note']) || fallbackText;
  const secondary = destination.platform === 'youtube'
    ? fieldText(destination.fields, ['description'])
    : '';

  return (
    <section className="sc6-final-preview">
      <div className="sc6-preview-heading"><strong>Aperçu final</strong><small>Rendu indicatif du format sélectionné.</small></div>
      {destinations.length > 1 && (
        <div className="sc6-preview-tabs">
          {destinations.map((item, itemIndex) => (
            <button type="button" key={`${item.platform}-${item.accountLabel}-${itemIndex}`} className={itemIndex === index ? 'active' : ''} onClick={() => onActiveIndex(itemIndex)}>
              <PlatformIcon platform={item.platform} /> {platformLabel(item.platform)}
            </button>
          ))}
        </div>
      )}

      {destination.platform === 'instagram' && (
        <article className="sc6-network-preview instagram">
          <header><span className="sc6-preview-avatar"><Camera size={13} /></span><div><strong>{destination.accountLabel}</strong><small>{destination.accountHandle || 'Instagram'}</small></div><b>•••</b></header>
          <Media media={media} destination={destination} />
          <div className="sc6-instagram-actions"><span>♡</span><span>○</span><span>⌁</span><span>⌑</span></div>
          <p><strong>{handle}</strong> {copy || 'Votre légende apparaîtra ici.'}</p>
        </article>
      )}

      {destination.platform === 'youtube' && (
        <article className={`sc6-network-preview youtube ${destination.format === 'short' ? 'short' : ''}`}>
          <Media media={media} destination={destination} />
          <div className="sc6-youtube-copy"><h3>{fieldText(destination.fields, ['title']) || copy || 'Titre de la vidéo'}</h3><p>{destination.accountLabel}</p>{secondary && <small>{secondary}</small>}</div>
        </article>
      )}

      {destination.platform === 'tiktok' && (
        <article className="sc6-network-preview tiktok">
          <Media media={media} destination={destination} />
          <div className="sc6-tiktok-overlay"><strong>@{handle.replace(/^@/, '')}</strong><p>{copy || 'Votre légende TikTok apparaîtra ici.'}</p></div>
          <div className="sc6-tiktok-actions"><span>♡</span><span>◯</span><span>↗</span></div>
        </article>
      )}
    </section>
  );
}
