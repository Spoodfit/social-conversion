import fs from 'node:fs';

function mustReplace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`LinkedIn publishing patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// ---- Shared publication model ----
const fieldsPath = 'src/shared/social-publication-fields.ts';
let fields = fs.readFileSync(fieldsPath, 'utf8');
if (!fields.includes('SC_LINKEDIN_PUBLISHING_FIELDS_V1')) {
  fields = mustReplace(
    fields,
    "export type PlanningPlatform = 'instagram' | 'facebook' | 'youtube' | 'tiktok';",
    "export type PlanningPlatform = 'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'tiktok';",
    'PlanningPlatform union',
  );

  const instagramSchemaAnchor = `  instagram: {\n    platform: 'instagram',`;
  fields = mustReplace(
    fields,
    instagramSchemaAnchor,
`  linkedin: {
    platform: 'linkedin',
    label: 'LinkedIn',
    formats: [
      {
        id: 'post',
        label: 'Publication',
        mediaHint: 'Texte ou image pour un profil LinkedIn.',
        fields: [
          { key: 'commentary', label: 'Texte', kind: 'textarea', maxLength: 3000, placeholder: 'Votre publication LinkedIn…' },
          {
            key: 'visibility',
            label: 'Visibilité',
            kind: 'select',
            options: [
              { value: 'PUBLIC', label: 'Publique' },
              { value: 'CONNECTIONS', label: 'Relations uniquement' },
            ],
            requiredToPlan: true,
            requiredToPublish: true,
          },
          { key: 'altText', label: 'Texte alternatif de l’image', kind: 'textarea', maxLength: 4000, help: 'Accessibilité de l’image.' },
        ],
      },
    ],
  },
${instagramSchemaAnchor}`,
    'LinkedIn publication schema',
  );

  fields = mustReplace(
    fields,
    "  return value === 'instagram' || value === 'facebook' || value === 'youtube' || value === 'tiktok';",
    "  return value === 'instagram' || value === 'facebook' || value === 'linkedin' || value === 'youtube' || value === 'tiktok';",
    'PlanningPlatform guard',
  );

  const youtubeSelect = `    if (field.kind === 'select' && field.options?.length && platform === 'youtube') {\n      result[field.key] = field.key === 'privacyStatus' ? 'private' : field.options[0]?.value ?? '';\n    }`;
  fields = mustReplace(
    fields,
    youtubeSelect,
`${youtubeSelect}
    if (field.kind === 'select' && field.options?.length && platform === 'linkedin') {
      result[field.key] = field.key === 'visibility' ? 'PUBLIC' : field.options[0]?.value ?? '';
    }`,
    'LinkedIn select defaults',
  );

  fields = mustReplace(
    fields,
    "  const keys = platform === 'facebook' ? ['message'] : platform === 'youtube' ? ['title', 'description'] : platform === 'tiktok' ? ['title', 'description'] : ['caption', 'note'];",
    "  const keys = platform === 'facebook' ? ['message'] : platform === 'linkedin' ? ['commentary'] : platform === 'youtube' ? ['title', 'description'] : platform === 'tiktok' ? ['title', 'description'] : ['caption', 'note'];",
    'LinkedIn preview text',
  );
  fields += '\n// SC_LINKEDIN_PUBLISHING_FIELDS_V1\n';
  fs.writeFileSync(fieldsPath, fields);
}

// ---- Destination editor ----
const editorPath = 'src/PlatformDestinationEditor.tsx';
let editor = fs.readFileSync(editorPath, 'utf8');
if (!editor.includes('SC_LINKEDIN_PUBLISHING_EDITOR_V1')) {
  editor = editor.replace(
    "import { Camera, Check, MessageCircle, Music2, Plus, Video } from 'lucide-react';",
    "import { Camera, Check, Linkedin, MessageCircle, Music2, Plus, Video } from 'lucide-react';",
  );
  editor = mustReplace(
    editor,
    `function PlatformIcon({ platform }: { platform: PlanningPlatform }) {\n  if (platform === 'facebook') return <MessageCircle size={15} />;`,
    `function PlatformIcon({ platform }: { platform: PlanningPlatform }) {\n  if (platform === 'linkedin') return <Linkedin size={15} />;\n  if (platform === 'facebook') return <MessageCircle size={15} />;`,
    'LinkedIn destination icon',
  );
  editor += '\n// SC_LINKEDIN_PUBLISHING_EDITOR_V1\n';
  fs.writeFileSync(editorPath, editor);
}

// ---- Destination resolution ----
const destinationsPath = 'src/worker/publishing-destinations.ts';
let destinations = fs.readFileSync(destinationsPath, 'utf8');
if (!destinations.includes('SC_LINKEDIN_PUBLISHING_DESTINATIONS_V1')) {
  const facebookUnion = `       SELECT id, workspace_id, platform, display_name, handle, status FROM social_connections\n       UNION ALL\n       SELECT id, workspace_id, 'facebook' AS platform, display_name, handle, status FROM facebook_connections`;
  destinations = mustReplace(
    destinations,
    facebookUnion,
`${facebookUnion}
       UNION ALL
       SELECT id, workspace_id, 'linkedin' AS platform, display_name, handle, status FROM linkedin_connections`,
    'LinkedIn destination connection lookup',
  );
  destinations = destinations.replace(
    `.filter((destination) => destination.connectionId && destination.connectionStatus === 'connected' && destination.platform !== 'facebook')`,
    `.filter((destination) => destination.connectionId && destination.connectionStatus === 'connected' && destination.platform !== 'facebook' && destination.platform !== 'linkedin')`,
  );
  destinations += '\n// SC_LINKEDIN_PUBLISHING_DESTINATIONS_V1\n';
  fs.writeFileSync(destinationsPath, destinations);
}

// ---- Publication reads resolve LinkedIn labels/status ----
const publishingPath = 'src/worker/publishing.ts';
let publishing = fs.readFileSync(publishingPath, 'utf8');
if (!publishing.includes('SC_LINKEDIN_PUBLISHING_READ_V1')) {
  const facebookUnion = `       SELECT id, workspace_id, platform, display_name, handle, status FROM social_connections\n       UNION ALL\n       SELECT id, workspace_id, 'facebook' AS platform, display_name, handle, status FROM facebook_connections`;
  publishing = mustReplace(
    publishing,
    facebookUnion,
`${facebookUnion}
       UNION ALL
       SELECT id, workspace_id, 'linkedin' AS platform, display_name, handle, status FROM linkedin_connections`,
    'LinkedIn publication connection join',
  );
  publishing += '\n// SC_LINKEDIN_PUBLISHING_READ_V1\n';
  fs.writeFileSync(publishingPath, publishing);
}

// ---- Production queue + cron ----
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('SC_LINKEDIN_PUBLISHING_QUEUE_V1')) {
  const facebookImport = `import {\n  enqueuePendingFacebookPublicationSyncs,\n  FacebookPublishingError,\n  isFacebookPublicationEnvelope,\n  processFacebookPublicationSync,\n  type FacebookPublicationEnvelope,\n} from './facebook-publishing';`;
  production = mustReplace(
    production,
    facebookImport,
`${facebookImport}
import {
  enqueuePendingLinkedInPublicationSyncs,
  isLinkedInPublicationEnvelope,
  LinkedInPublishingError,
  processLinkedInPublicationSync,
  type LinkedInPublicationEnvelope,
} from './linkedin-publishing';`,
    'LinkedIn production import',
  );
  production = mustReplace(
    production,
    `type ProductionQueueMessage = NormalizedSocialEvent | OutboundDeliveryEnvelope | YouTubeSyncEnvelope | FacebookPublicationEnvelope;`,
    `type ProductionQueueMessage = NormalizedSocialEvent | OutboundDeliveryEnvelope | YouTubeSyncEnvelope | FacebookPublicationEnvelope | LinkedInPublicationEnvelope;`,
    'LinkedIn queue type',
  );

  const facebookConsumerAnchor = `      if (isFacebookPublicationEnvelope(message.body)) {`;
  production = mustReplace(
    production,
    facebookConsumerAnchor,
`      if (isLinkedInPublicationEnvelope(message.body)) {
        try {
          const result = await processLinkedInPublicationSync(env, message.body);
          console.log(JSON.stringify({ event: 'linkedin_publication_sync_processed', workspaceId: message.body.workspaceId, postId: message.body.postId, ...result }));
          message.ack();
        } catch (error) {
          console.error(JSON.stringify({
            event: 'linkedin_publication_sync_failed',
            workspaceId: message.body.workspaceId,
            postId: message.body.postId,
            retryable: error instanceof LinkedInPublishingError ? error.retryable : true,
            message: error instanceof Error ? error.message : 'unknown',
          }));
          if (error instanceof LinkedInPublishingError && !error.retryable) message.ack();
          else message.retry({ delaySeconds: 60 });
        }
        continue;
      }

${facebookConsumerAnchor}`,
    'LinkedIn queue consumer',
  );

  const dispatchAnchor = `    try {\n      await dispatchPending(env);`;
  production = mustReplace(
    production,
    dispatchAnchor,
`    try {
      const linkedinPublicationQueued = await enqueuePendingLinkedInPublicationSyncs(env, 20);
      if (linkedinPublicationQueued > 0) console.log(JSON.stringify({ event: 'linkedin_publication_sync_sweep', queued: linkedinPublicationQueued }));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'linkedin_publication_sync_sweep_failed',
        message: error instanceof Error ? error.message : 'unknown',
      }));
    }

${dispatchAnchor}`,
    'LinkedIn scheduled sweep',
  );
  production += '\n// SC_LINKEDIN_PUBLISHING_QUEUE_V1\n';
  fs.writeFileSync(productionPath, production);
}

// ---- Publication API enqueue + runtime readiness ----
const cockpitPath = 'src/worker/cockpit-production.ts';
let cockpit = fs.readFileSync(cockpitPath, 'utf8');
if (!cockpit.includes('SC_LINKEDIN_PUBLISHING_COCKPIT_V1')) {
  const facebookImport = `import { enqueueFacebookPublicationSync, facebookPublishingConfigured } from './facebook-publishing';`;
  cockpit = mustReplace(
    cockpit,
    facebookImport,
`${facebookImport}
import { enqueueLinkedInPublicationSync, linkedinPublishingConfigured } from './linkedin-publishing';`,
    'LinkedIn cockpit import',
  );
  cockpit = cockpit.replaceAll(
    `      await enqueueFacebookPublicationSync(env, auth.principal.workspaceId, publication.id);`,
    `      await enqueueFacebookPublicationSync(env, auth.principal.workspaceId, publication.id);\n      await enqueueLinkedInPublicationSync(env, auth.principal.workspaceId, publication.id);`,
  );
  cockpit = cockpit.replaceAll(
    `      await enqueueFacebookPublicationSync(env, auth.principal.workspaceId, publicationId);`,
    `      await enqueueFacebookPublicationSync(env, auth.principal.workspaceId, publicationId);\n      await enqueueLinkedInPublicationSync(env, auth.principal.workspaceId, publicationId);`,
  );
  cockpit = mustReplace(
    cockpit,
    `          facebookPublishingReady: isLive(env) && facebookPublishingConfigured(env),`,
    `          facebookPublishingReady: isLive(env) && facebookPublishingConfigured(env),\n          linkedinPublishingReady: isLive(env) && linkedinPublishingConfigured(env),`,
    'LinkedIn runtime readiness',
  );
  cockpit += '\n// SC_LINKEDIN_PUBLISHING_COCKPIT_V1\n';
  fs.writeFileSync(cockpitPath, cockpit);
}

// ---- Live app: make LinkedIn a real publishing destination ----
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_LINKEDIN_PUBLISHING_UI_V1')) {
  if (!app.includes('linkedinPublishingReady?: boolean;')) {
    const runtimeAnchor = app.includes('  facebookPublishingReady?: boolean;')
      ? '  facebookPublishingReady?: boolean;'
      : '  publishingSchedulerReady?: boolean;';
    app = mustReplace(app, runtimeAnchor, `${runtimeAnchor}\n  linkedinPublishingReady?: boolean;`, 'LinkedIn publishing runtime type');
  }

  app = app.replace(
    `  const publishableConnections = useMemo(() => connections.filter((connection): connection is LiveConnection & { platform: PlanningPlatform } => connection.platform !== 'linkedin'), [connections]);`,
    `  const publishableConnections = useMemo(() => connections.filter((connection): connection is LiveConnection & { platform: PlanningPlatform } => connection.platform === 'instagram' || connection.platform === 'facebook' || connection.platform === 'linkedin' || connection.platform === 'youtube' || connection.platform === 'tiktok'), [connections]);`,
  );
  app = app.replaceAll(
    `selected?.platform === 'linkedin' ? [] : [id]`,
    `[id]`,
  );
  app = app.replaceAll(
    `selected?.platform === 'facebook' || selected?.platform === 'linkedin' ? [] : [id]`,
    `[id]`,
  );
  app = app.replaceAll(
    `activeConnection?.platform === 'linkedin' ? [] : [activeAccountId]`,
    `[activeAccountId]`,
  );
  app = app.replaceAll(
    `activeConnection?.platform === 'facebook' || activeConnection?.platform === 'linkedin' ? [] : [activeAccountId]`,
    `[activeAccountId]`,
  );
  app = app.replaceAll(
    `activeAccountId !== 'all' && activeConnection?.platform !== 'linkedin'\n      ? [activeAccountId]`,
    `activeAccountId !== 'all'\n      ? [activeAccountId]`,
  );

  app = mustReplace(
    app,
    `function guidedCompatiblePlatforms(format: MediaFormat): PlanningPlatform[] {\n  if (format === 'story') return ['instagram'];\n  if (format === 'post') return ['instagram', 'facebook', 'tiktok'];\n  return ['instagram', 'youtube', 'tiktok'];\n}`,
    `function guidedCompatiblePlatforms(format: MediaFormat): PlanningPlatform[] {\n  if (format === 'story') return ['instagram'];\n  if (format === 'post') return ['instagram', 'facebook', 'linkedin', 'tiktok'];\n  return ['instagram', 'youtube', 'tiktok'];\n}`,
    'LinkedIn guided compatible platforms',
  );
  app = mustReplace(
    app,
    `function guidedDefaultFormat(platform: PlanningPlatform, format: MediaFormat) {\n  if (platform === 'facebook') return 'post';`,
    `function guidedDefaultFormat(platform: PlanningPlatform, format: MediaFormat) {\n  if (platform === 'linkedin') return 'post';\n  if (platform === 'facebook') return 'post';`,
    'LinkedIn default format',
  );
  app = app.replaceAll(
    `(['instagram', 'facebook', 'youtube', 'tiktok'] as PlanningPlatform[])`,
    `(['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok'] as PlanningPlatform[])`,
  );
  app = app.replaceAll(
    `Ajoutez Facebook, Instagram, YouTube ou TikTok depuis les réglages pour pouvoir publier.`,
    `Ajoutez Facebook, Instagram, LinkedIn, YouTube ou TikTok depuis les réglages pour pouvoir publier.`,
  );
  if (!app.includes("connection.platform === 'linkedin' || connection.platform === 'tiktok'")) {
    // The actual publishable list assertion below is the source of truth; no extra UI branch required.
  }
  if (!app.includes("connection.platform === 'linkedin'")) {
    throw new Error('LinkedIn publishing patch failed: LinkedIn is still absent from LiveApp publishing routing.');
  }
  app += '\n/* SC_LINKEDIN_PUBLISHING_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

// ---- Composer provider preview ----
const previewPath = 'src/PlannerComposerPreview.tsx';
let preview = fs.readFileSync(previewPath, 'utf8');
if (!preview.includes('SC_LINKEDIN_COMPOSER_PREVIEW_V1')) {
  preview = preview.replace(
    `import { Camera, MessageCircle, Music2, Video } from 'lucide-react';`,
    `import { Camera, Linkedin, MessageCircle, Music2, Video } from 'lucide-react';`,
  );
  preview = mustReplace(
    preview,
    `  platform: 'instagram' | 'facebook' | 'youtube' | 'tiktok';`,
    `  platform: 'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'tiktok';`,
    'LinkedIn preview destination type',
  );
  preview = mustReplace(
    preview,
    `function platformLabel(platform: ComposerPreviewDestination['platform']) {\n  if (platform === 'facebook') return 'Facebook';`,
    `function platformLabel(platform: ComposerPreviewDestination['platform']) {\n  if (platform === 'linkedin') return 'LinkedIn';\n  if (platform === 'facebook') return 'Facebook';`,
    'LinkedIn preview label',
  );
  preview = mustReplace(
    preview,
    `function PlatformIcon({ platform }: { platform: ComposerPreviewDestination['platform'] }) {\n  if (platform === 'facebook') return <MessageCircle size={14} />;`,
    `function PlatformIcon({ platform }: { platform: ComposerPreviewDestination['platform'] }) {\n  if (platform === 'linkedin') return <Linkedin size={14} />;\n  if (platform === 'facebook') return <MessageCircle size={14} />;`,
    'LinkedIn preview icon',
  );
  preview = preview.replace(
    `Puis sélectionnez Facebook, Instagram, YouTube ou TikTok.`,
    `Puis sélectionnez Facebook, Instagram, LinkedIn, YouTube ou TikTok.`,
  );
  preview = mustReplace(
    preview,
    `  const copy = destination.platform === 'facebook'\n    ? fieldText(destination.fields, ['message']) || fallbackText\n    : destination.platform === 'youtube'`,
    `  const copy = destination.platform === 'facebook'\n    ? fieldText(destination.fields, ['message']) || fallbackText\n    : destination.platform === 'linkedin'\n      ? fieldText(destination.fields, ['commentary']) || fallbackText\n      : destination.platform === 'youtube'`,
    'LinkedIn preview copy',
  );
  const instagramPreviewAnchor = `      {destination.platform === 'instagram' && (`;
  preview = mustReplace(
    preview,
    instagramPreviewAnchor,
`      {destination.platform === 'linkedin' && (
        <article className="sc6-network-preview linkedin">
          <header><span className="sc6-preview-avatar"><Linkedin size={13} /></span><div><strong>{destination.accountLabel}</strong><small>{destination.accountHandle || 'LinkedIn'}</small></div><b>•••</b></header>
          <p>{copy || 'Votre publication LinkedIn apparaîtra ici.'}</p>
          <Media media={media} destination={destination} />
        </article>
      )}

${instagramPreviewAnchor}`,
    'LinkedIn preview card',
  );
  preview += '\n// SC_LINKEDIN_COMPOSER_PREVIEW_V1\n';
  fs.writeFileSync(previewPath, preview);
}

// ---- AI/social copy writer ----
const copyPath = 'src/worker/social-copy-writer.ts';
let copy = fs.readFileSync(copyPath, 'utf8');
if (!copy.includes('SC_LINKEDIN_COPY_TYPE_V1')) {
  copy = mustReplace(
    copy,
    `const EDITORIAL_KEYS: Record<PlanningPlatform, Set<string>> = {\n  facebook: new Set(['message']),`,
    `const EDITORIAL_KEYS: Record<PlanningPlatform, Set<string>> = {\n  facebook: new Set(['message']),\n  linkedin: new Set(['commentary']),`,
    'LinkedIn editorial key',
  );
  copy = copy.replace(
    `'platform must be facebook, instagram, youtube or tiktok.'`,
    `'platform must be facebook, instagram, linkedin, youtube or tiktok.'`,
  );
  copy += '\n// SC_LINKEDIN_COPY_TYPE_V1\n';
  fs.writeFileSync(copyPath, copy);
}

console.log('LinkedIn profile publishing is wired into Planner, queue, composer and remote status tracking.');
