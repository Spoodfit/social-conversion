import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Facebook publishing type fix failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const publishingPath = 'src/worker/facebook-publishing.ts';
let publishing = fs.readFileSync(publishingPath, 'utf8');
if (!publishing.includes('SC_FACEBOOK_PUBLISHING_NULL_FIX_V1')) {
  publishing = replaceOnce(
    publishing,
    `async function loadDestination(db: D1Database, workspaceId: string, postId: string): Promise<FacebookDestinationRow | undefined> {\n  return db.prepare(`,
    `async function loadDestination(db: D1Database, workspaceId: string, postId: string): Promise<FacebookDestinationRow | undefined> {\n  const row = await db.prepare(`,
    'Facebook destination nullable read',
  );
  publishing = replaceOnce(
    publishing,
    `  ).bind(workspaceId, postId).first<FacebookDestinationRow>() ?? undefined;\n}`,
    `  ).bind(workspaceId, postId).first<FacebookDestinationRow>();\n  return row ?? undefined;\n}`,
    'Facebook destination nullable return',
  );
  publishing += '\n// SC_FACEBOOK_PUBLISHING_NULL_FIX_V1\n';
  fs.writeFileSync(publishingPath, publishing);
}

const copyPath = 'src/worker/social-copy-writer.ts';
let copy = fs.readFileSync(copyPath, 'utf8');
if (!copy.includes('SC_FACEBOOK_COPY_TYPE_V1')) {
  copy = replaceOnce(
    copy,
    `const EDITORIAL_KEYS: Record<PlanningPlatform, Set<string>> = {\n  instagram: new Set(['caption']),`,
    `const EDITORIAL_KEYS: Record<PlanningPlatform, Set<string>> = {\n  facebook: new Set(['message']),\n  instagram: new Set(['caption']),`,
    'Facebook editorial key',
  );
  copy = copy.replace(
    `'platform must be instagram, youtube or tiktok.'`,
    `'platform must be facebook, instagram, youtube or tiktok.'`,
  );
  copy += '\n// SC_FACEBOOK_COPY_TYPE_V1\n';
  fs.writeFileSync(copyPath, copy);
}

const previewPath = 'src/PlannerComposerPreview.tsx';
let preview = fs.readFileSync(previewPath, 'utf8');
if (!preview.includes('SC_FACEBOOK_COMPOSER_PREVIEW_V1')) {
  preview = preview.replace(
    `import { Camera, Music2, Video } from 'lucide-react';`,
    `import { Camera, MessageCircle, Music2, Video } from 'lucide-react';`,
  );
  preview = replaceOnce(
    preview,
    `  platform: 'instagram' | 'youtube' | 'tiktok';`,
    `  platform: 'instagram' | 'facebook' | 'youtube' | 'tiktok';`,
    'Facebook preview destination type',
  );
  preview = replaceOnce(
    preview,
    `function platformLabel(platform: ComposerPreviewDestination['platform']) {\n  if (platform === 'instagram') return 'Instagram';`,
    `function platformLabel(platform: ComposerPreviewDestination['platform']) {\n  if (platform === 'facebook') return 'Facebook';\n  if (platform === 'instagram') return 'Instagram';`,
    'Facebook preview label',
  );
  preview = replaceOnce(
    preview,
    `function PlatformIcon({ platform }: { platform: ComposerPreviewDestination['platform'] }) {\n  if (platform === 'instagram') return <Camera size={14} />;`,
    `function PlatformIcon({ platform }: { platform: ComposerPreviewDestination['platform'] }) {\n  if (platform === 'facebook') return <MessageCircle size={14} />;\n  if (platform === 'instagram') return <Camera size={14} />;`,
    'Facebook preview icon',
  );
  preview = preview.replace(
    `Puis sélectionnez Instagram, YouTube ou TikTok.`,
    `Puis sélectionnez Facebook, Instagram, YouTube ou TikTok.`,
  );
  preview = replaceOnce(
    preview,
    `  const copy = destination.platform === 'youtube'\n    ? fieldText(destination.fields, ['title', 'description']) || fallbackText`,
    `  const copy = destination.platform === 'facebook'\n    ? fieldText(destination.fields, ['message']) || fallbackText\n    : destination.platform === 'youtube'\n      ? fieldText(destination.fields, ['title', 'description']) || fallbackText`,
    'Facebook preview copy',
  );
  preview = replaceOnce(
    preview,
    `      {destination.platform === 'instagram' && (`,
    `      {destination.platform === 'facebook' && (\n        <article className="sc6-network-preview facebook">\n          <header><span className="sc6-preview-avatar"><MessageCircle size={13} /></span><div><strong>{destination.accountLabel}</strong><small>{destination.accountHandle || 'Facebook'}</small></div><b>•••</b></header>\n          <p><strong>{destination.accountLabel}</strong> {copy || 'Votre publication Facebook apparaîtra ici.'}</p>\n          <Media media={media} destination={destination} />\n        </article>\n      )}\n\n      {destination.platform === 'instagram' && (`,
    'Facebook preview card',
  );
  preview += '\n// SC_FACEBOOK_COMPOSER_PREVIEW_V1\n';
  fs.writeFileSync(previewPath, preview);
}

console.log('Facebook publishing types and composer preview completed.');
