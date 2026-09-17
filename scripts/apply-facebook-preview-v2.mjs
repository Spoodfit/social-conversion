import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Facebook preview v2 patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const previewPath = 'src/PlannerComposerPreview.tsx';
let preview = fs.readFileSync(previewPath, 'utf8');

if (!preview.includes('SC_FACEBOOK_COMPOSER_PREVIEW_V2')) {
  preview = replaceOnce(
    preview,
    `import { Camera, MessageCircle, Music2, Video } from 'lucide-react';`,
    `import { Camera, Globe2, MessageCircle, MoreHorizontal, Music2, Share2, ThumbsUp, Video } from 'lucide-react';`,
    'Facebook preview icons',
  );

  const helperAnchor = `export default function PlannerComposerPreview({`;
  const helper = `function cleanFacebookPageName(value: string) {\n  return value\n    .replace(/^facebook\\s*[·|:–—-]\\s*/i, '')\n    .replace(/\\s*[·|:–—-]?\\s*facebook$/i, '')\n    .trim() || 'Page Facebook';\n}\n\nfunction facebookAccountDetail(destination: ComposerPreviewDestination) {\n  const pageName = cleanFacebookPageName(destination.accountLabel);\n  const raw = destination.accountHandle?.trim() || '';\n  if (!raw || /^facebook$/i.test(raw) || cleanFacebookPageName(raw) === pageName) return 'Page Facebook';\n  return raw;\n}\n\nfunction facebookInitials(value: string) {\n  const parts = cleanFacebookPageName(value).split(/\\s+/).filter(Boolean);\n  return (parts.length > 1 ? parts[0]!.charAt(0) + parts[1]!.charAt(0) : parts[0]?.slice(0, 2) || 'FB').toUpperCase();\n}\n\nfunction FacebookMedia({ media }: { media?: PreviewMedia }) {\n  if (!media?.previewUrl) return null;\n  if (media.mimeType.startsWith('image/')) {\n    return (\n      <div className=\"scfb-media image\">\n        <img src={media.previewUrl} alt={media.title || 'Visuel de la publication Facebook'} />\n      </div>\n    );\n  }\n  if (media.mimeType.startsWith('video/')) {\n    return (\n      <div className=\"scfb-media video\">\n        <video src={media.previewUrl} muted playsInline preload=\"metadata\" />\n        <span className=\"scfb-play\" aria-hidden=\"true\">▶</span>\n      </div>\n    );\n  }\n  return <div className=\"scfb-media-unavailable\">Aperçu du média indisponible</div>;\n}\n\nfunction FacebookPreview({ destination, media, copy }: { destination: ComposerPreviewDestination; media?: PreviewMedia; copy: string }) {\n  const pageName = cleanFacebookPageName(destination.accountLabel);\n  const accountDetail = facebookAccountDetail(destination);\n  const link = fieldText(destination.fields, ['link', 'url', 'linkUrl']);\n  const hasMedia = Boolean(media?.previewUrl);\n  const hasCopy = Boolean(copy.trim());\n\n  return (\n    <article className={\`sc6-network-preview facebook scfb-facebook-preview \${hasMedia ? 'has-media' : 'no-media'}\`}>\n      <header className=\"scfb-head\">\n        <span className=\"scfb-avatar\" aria-hidden=\"true\">{facebookInitials(pageName)}</span>\n        <span className=\"scfb-identity\">\n          <strong>{pageName}</strong>\n          <small>{accountDetail} <span aria-hidden=\"true\">·</span> <Globe2 size={10} aria-label=\"Public\" /></small>\n        </span>\n        <MoreHorizontal size={18} aria-hidden=\"true\" />\n      </header>\n\n      {hasCopy && <p className=\"scfb-copy\">{copy}</p>}\n      {!hasCopy && !hasMedia && <p className=\"scfb-copy scfb-copy-placeholder\">Votre publication Facebook apparaîtra ici.</p>}\n\n      <FacebookMedia media={media} />\n\n      {link && (\n        <div className=\"scfb-link-preview\">\n          <small>LIEN</small>\n          <strong>{link.replace(/^https?:\\/\\//i, '').replace(/\\/$/, '')}</strong>\n        </div>\n      )}\n\n      <div className=\"scfb-feedback-row\" aria-hidden=\"true\">\n        <span><span className=\"scfb-like-dot\">f</span> Aperçu des interactions</span>\n      </div>\n      <div className=\"scfb-actions\" aria-hidden=\"true\">\n        <span><ThumbsUp size={16} /> J’aime</span>\n        <span><MessageCircle size={16} /> Commenter</span>\n        <span><Share2 size={16} /> Partager</span>\n      </div>\n    </article>\n  );\n}\n\n`;
  preview = replaceOnce(preview, helperAnchor, `${helper}${helperAnchor}`, 'Facebook preview helper insertion');

  const oldFacebookBlock = `      {destination.platform === 'facebook' && (\n        <article className=\"sc6-network-preview facebook\">\n          <header><span className=\"sc6-preview-avatar\"><MessageCircle size={13} /></span><div><strong>{destination.accountLabel}</strong><small>{destination.accountHandle || 'Facebook'}</small></div><b>•••</b></header>\n          <p><strong>{destination.accountLabel}</strong> {copy || 'Votre publication Facebook apparaîtra ici.'}</p>\n          <Media media={media} destination={destination} />\n        </article>\n      )}`;
  const newFacebookBlock = `      {destination.platform === 'facebook' && (\n        <FacebookPreview destination={destination} media={media} copy={copy} />\n      )}`;
  preview = replaceOnce(preview, oldFacebookBlock, newFacebookBlock, 'Facebook preview card');

  preview += '\n// SC_FACEBOOK_COMPOSER_PREVIEW_V2\n';
  fs.writeFileSync(previewPath, preview);
}

console.log('Facebook composer preview v2 applied.');
