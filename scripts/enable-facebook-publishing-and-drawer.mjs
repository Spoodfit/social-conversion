import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Facebook publishing/drawer patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Facebook becomes a real Planner publishing platform.
const fieldsPath = 'src/shared/social-publication-fields.ts';
let fields = fs.readFileSync(fieldsPath, 'utf8');
if (!fields.includes('SC_FACEBOOK_PUBLISHING_FIELDS_V1')) {
  fields = replaceOnce(
    fields,
    "export type PlanningPlatform = 'instagram' | 'youtube' | 'tiktok';",
    "export type PlanningPlatform = 'instagram' | 'facebook' | 'youtube' | 'tiktok';",
    'PlanningPlatform Facebook union',
  );

  fields = replaceOnce(
    fields,
    `export const publicationPlatformSchemas: Record<PlanningPlatform, PublicationPlatformDefinition> = {\n  instagram: {`,
    `export const publicationPlatformSchemas: Record<PlanningPlatform, PublicationPlatformDefinition> = {\n  facebook: {\n    platform: 'facebook',\n    label: 'Facebook',\n    formats: [\n      {\n        id: 'post',\n        label: 'Publication',\n        mediaHint: 'Image ou texte pour une Page Facebook.',\n        fields: [\n          { key: 'message', label: 'Texte', kind: 'textarea', maxLength: 5000, placeholder: 'Votre publication Facebook…' },\n        ],\n      },\n    ],\n  },\n  instagram: {`,
    'Facebook publication schema',
  );

  fields = replaceOnce(
    fields,
    "  return value === 'instagram' || value === 'youtube' || value === 'tiktok';",
    "  return value === 'instagram' || value === 'facebook' || value === 'youtube' || value === 'tiktok';",
    'Facebook planning platform guard',
  );

  fields = replaceOnce(
    fields,
    "  const keys = platform === 'youtube' ? ['title', 'description'] : platform === 'tiktok' ? ['title', 'description'] : ['caption', 'note'];",
    "  const keys = platform === 'facebook' ? ['message'] : platform === 'youtube' ? ['title', 'description'] : platform === 'tiktok' ? ['title', 'description'] : ['caption', 'note'];",
    'Facebook publication preview text',
  );

  fields += '\n// SC_FACEBOOK_PUBLISHING_FIELDS_V1\n';
  fs.writeFileSync(fieldsPath, fields);
}

// 2) Destination editor: expose Facebook for image posts.
const destinationEditorPath = 'src/PlatformDestinationEditor.tsx';
let editor = fs.readFileSync(destinationEditorPath, 'utf8');
if (!editor.includes('SC_FACEBOOK_PUBLISHING_EDITOR_V1')) {
  editor = editor.replace(
    "import { Camera, Check, Music2, Plus, Video } from 'lucide-react';",
    "import { Camera, Check, MessageCircle, Music2, Plus, Video } from 'lucide-react';",
  );
  editor = replaceOnce(
    editor,
    `function PlatformIcon({ platform }: { platform: PlanningPlatform }) {\n  if (platform === 'instagram') return <Camera size={15} />;`,
    `function PlatformIcon({ platform }: { platform: PlanningPlatform }) {\n  if (platform === 'facebook') return <MessageCircle size={15} />;\n  if (platform === 'instagram') return <Camera size={15} />;`,
    'Facebook destination icon',
  );
  editor = replaceOnce(
    editor,
    `  if (mediaFormat === 'post') return (platform === 'instagram' && (format === 'post' || format === 'carousel')) || (platform === 'tiktok' && format === 'photo');`,
    editor.includes("platform === 'facebook' && format === 'post'")
      ? `  if (mediaFormat === 'post') return (platform === 'facebook' && format === 'post') || (platform === 'instagram' && (format === 'post' || format === 'carousel')) || (platform === 'tiktok' && format === 'photo');`
      : `  if (mediaFormat === 'post') return (platform === 'facebook' && format === 'post') || (platform === 'instagram' && (format === 'post' || format === 'carousel')) || (platform === 'tiktok' && format === 'photo');`,
    'Facebook image compatibility',
  );
  editor += '\n// SC_FACEBOOK_PUBLISHING_EDITOR_V1\n';
  fs.writeFileSync(destinationEditorPath, editor);
}

// 3) Worker destination resolution: Facebook Pages live in facebook_connections.
const destinationsPath = 'src/worker/publishing-destinations.ts';
let destinations = fs.readFileSync(destinationsPath, 'utf8');
if (!destinations.includes('SC_FACEBOOK_PUBLISHING_DESTINATIONS_V1')) {
  destinations = replaceOnce(
    destinations,
`  const result = await db.prepare(\n    \`SELECT id, platform, display_name, handle, status\n     FROM social_connections\n     WHERE workspace_id = ? AND id IN (\${placeholders})\`,\n  ).bind(workspaceId, ...ids).all<ConnectionRow>();`,
`  const result = await db.prepare(\n    \`SELECT id, platform, display_name, handle, status\n     FROM (\n       SELECT id, workspace_id, platform, display_name, handle, status FROM social_connections\n       UNION ALL\n       SELECT id, workspace_id, 'facebook' AS platform, display_name, handle, status FROM facebook_connections\n     )\n     WHERE workspace_id = ? AND id IN (\${placeholders})\`,\n  ).bind(workspaceId, ...ids).all<ConnectionRow>();`,
    'Facebook destination connection lookup',
  );
  destinations = replaceOnce(
    destinations,
    `.filter((destination) => destination.connectionId && destination.connectionStatus === 'connected')`,
    `.filter((destination) => destination.connectionId && destination.connectionStatus === 'connected' && destination.platform !== 'facebook')`,
    'Skip Facebook legacy target FK',
  );
  destinations += '\n// SC_FACEBOOK_PUBLISHING_DESTINATIONS_V1\n';
  fs.writeFileSync(destinationsPath, destinations);
}

// 4) Publication reads resolve labels/status from both connection stores.
const publishingPath = 'src/worker/publishing.ts';
let publishing = fs.readFileSync(publishingPath, 'utf8');
if (!publishing.includes('SC_FACEBOOK_PUBLISHING_READ_V1')) {
  publishing = replaceOnce(
    publishing,
    `     LEFT JOIN social_connections sc ON sc.id = d.connection_id AND sc.workspace_id = p.workspace_id`,
    `     LEFT JOIN (\n       SELECT id, workspace_id, platform, display_name, handle, status FROM social_connections\n       UNION ALL\n       SELECT id, workspace_id, 'facebook' AS platform, display_name, handle, status FROM facebook_connections\n     ) sc ON sc.id = d.connection_id AND sc.workspace_id = p.workspace_id`,
    'Facebook publication connection join',
  );
  publishing += '\n// SC_FACEBOOK_PUBLISHING_READ_V1\n';
  fs.writeFileSync(publishingPath, publishing);
}

// 5) Queue + cron integration.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('SC_FACEBOOK_PUBLISHING_QUEUE_V1')) {
  const importAnchor = `import {\n  enqueuePendingYouTubePublicationSyncs,\n  isYouTubeSyncEnvelope,\n  processYouTubePublicationSync,\n  YouTubePublishingError,\n  type YouTubeSyncEnvelope,\n} from './youtube-publishing';`;
  production = replaceOnce(
    production,
    importAnchor,
    `${importAnchor}\nimport {\n  enqueuePendingFacebookPublicationSyncs,\n  FacebookPublishingError,\n  isFacebookPublicationEnvelope,\n  processFacebookPublicationSync,\n  type FacebookPublicationEnvelope,\n} from './facebook-publishing';`,
    'Facebook publishing production import',
  );

  production = replaceOnce(
    production,
    `type ProductionQueueMessage = NormalizedSocialEvent | OutboundDeliveryEnvelope | YouTubeSyncEnvelope;`,
    `type ProductionQueueMessage = NormalizedSocialEvent | OutboundDeliveryEnvelope | YouTubeSyncEnvelope | FacebookPublicationEnvelope;`,
    'Facebook queue message type',
  );

  production = replaceOnce(
    production,
    `    for (const message of batch.messages) {\n      if (isYouTubeSyncEnvelope(message.body)) {`,
    `    for (const message of batch.messages) {\n      if (isFacebookPublicationEnvelope(message.body)) {\n        try {\n          const result = await processFacebookPublicationSync(env, message.body);\n          console.log(JSON.stringify({ event: 'facebook_publication_sync_processed', workspaceId: message.body.workspaceId, postId: message.body.postId, ...result }));\n          message.ack();\n        } catch (error) {\n          console.error(JSON.stringify({\n            event: 'facebook_publication_sync_failed',\n            workspaceId: message.body.workspaceId,\n            postId: message.body.postId,\n            retryable: error instanceof FacebookPublishingError ? error.retryable : true,\n            message: error instanceof Error ? error.message : 'unknown',\n          }));\n          if (error instanceof FacebookPublishingError && !error.retryable) message.ack();\n          else message.retry({ delaySeconds: 60 });\n        }\n        continue;\n      }\n\n      if (isYouTubeSyncEnvelope(message.body)) {`,
    'Facebook queue consumer',
  );

  production = replaceOnce(
    production,
    `    try {\n      await dispatchPending(env);`,
    `    try {\n      const facebookPublicationQueued = await enqueuePendingFacebookPublicationSyncs(env, 20);\n      if (facebookPublicationQueued > 0) console.log(JSON.stringify({ event: 'facebook_publication_sync_sweep', queued: facebookPublicationQueued }));\n    } catch (error) {\n      console.error(JSON.stringify({\n        event: 'facebook_publication_sync_sweep_failed',\n        message: error instanceof Error ? error.message : 'unknown',\n      }));\n    }\n\n    try {\n      await dispatchPending(env);`,
    'Facebook publishing scheduled sweep',
  );

  production += '\n// SC_FACEBOOK_PUBLISHING_QUEUE_V1\n';
  fs.writeFileSync(productionPath, production);
}

// 6) Publication API enqueues Facebook exactly like YouTube.
const cockpitPath = 'src/worker/cockpit-production.ts';
let cockpit = fs.readFileSync(cockpitPath, 'utf8');
if (!cockpit.includes('SC_FACEBOOK_PUBLISHING_COCKPIT_V1')) {
  cockpit = replaceOnce(
    cockpit,
    `import { enqueueYouTubePublicationSync, youtubePublishingConfigured } from './youtube-publishing';`,
    `import { enqueueYouTubePublicationSync, youtubePublishingConfigured } from './youtube-publishing';\nimport { enqueueFacebookPublicationSync, facebookPublishingConfigured } from './facebook-publishing';`,
    'Facebook cockpit import',
  );
  cockpit = cockpit.replaceAll(
    `      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publication.id);`,
    `      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publication.id);\n      await enqueueFacebookPublicationSync(env, auth.principal.workspaceId, publication.id);`,
  );
  cockpit = cockpit.replaceAll(
    `      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publicationId);`,
    `      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publicationId);\n      await enqueueFacebookPublicationSync(env, auth.principal.workspaceId, publicationId);`,
  );
  cockpit = replaceOnce(
    cockpit,
    `          youtubePublishingReady: isLive(env) && youtubePublishingConfigured(env),`,
    `          youtubePublishingReady: isLive(env) && youtubePublishingConfigured(env),\n          facebookPublishingReady: isLive(env) && facebookPublishingConfigured(env),`,
    'Facebook runtime readiness',
  );
  cockpit += '\n// SC_FACEBOOK_PUBLISHING_COCKPIT_V1\n';
  fs.writeFileSync(cockpitPath, cockpit);
}

// 7) UI: Facebook is selectable for publishing and publication cards always open internally.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_FACEBOOK_PUBLISHING_UI_V1')) {
  if (!app.includes('facebookPublishingReady?: boolean;')) {
    app = app.replace('  youtubePublishingReady?: boolean;\n', '  youtubePublishingReady?: boolean;\n  facebookPublishingReady?: boolean;\n');
  }

  app = replaceOnce(
    app,
    `  platform: SocialPlatform;\n  status: string;`,
    `  platform: PlanningPlatform;\n  status: string;`,
    'PublicationTarget Facebook type',
  );

  app = replaceOnce(
    app,
    `  const publishableConnections = useMemo(() => connections.filter((connection): connection is LiveConnection & { platform: SocialPlatform } => connection.platform !== 'facebook' && connection.platform !== 'linkedin'), [connections]);`,
    `  const publishableConnections = useMemo(() => connections.filter((connection): connection is LiveConnection & { platform: PlanningPlatform } => connection.platform !== 'linkedin'), [connections]);`,
    'Facebook publishable connection list',
  );

  app = app.replace(
    `setSelectedConnectionIds(activeAccountId !== 'all' && activeConnection?.platform !== 'facebook' && activeConnection?.platform !== 'linkedin'`,
    `setSelectedConnectionIds(activeAccountId !== 'all' && activeConnection?.platform !== 'linkedin'`,
  );
  app = app.replaceAll(
    `selected?.platform === 'facebook' ? [] : [id]`,
    `[id]`,
  );
  app = app.replaceAll(
    `activeConnection?.platform === 'facebook' ? [] : [activeAccountId]`,
    `[activeAccountId]`,
  );

  app = replaceOnce(
    app,
    `function guidedCompatiblePlatforms(format: MediaFormat): PlanningPlatform[] {\n  if (format === 'story') return ['instagram'];\n  if (format === 'post') return ['instagram', 'tiktok'];\n  return ['instagram', 'youtube', 'tiktok'];\n}`,
    `function guidedCompatiblePlatforms(format: MediaFormat): PlanningPlatform[] {\n  if (format === 'story') return ['instagram'];\n  if (format === 'post') return ['instagram', 'facebook', 'tiktok'];\n  return ['instagram', 'youtube', 'tiktok'];\n}`,
    'Facebook guided compatible platforms',
  );

  app = replaceOnce(
    app,
    `function guidedDefaultFormat(platform: PlanningPlatform, format: MediaFormat) {\n  if (platform === 'instagram') return format === 'post' ? 'post' : format === 'story' ? 'story' : 'reel';`,
    `function guidedDefaultFormat(platform: PlanningPlatform, format: MediaFormat) {\n  if (platform === 'facebook') return 'post';\n  if (platform === 'instagram') return format === 'post' ? 'post' : format === 'story' ? 'story' : 'reel';`,
    'Facebook guided default format',
  );

  app = app.replace(
    `  connections: Array<LiveConnection & { platform: SocialPlatform }>;`,
    `  connections: Array<LiveConnection & { platform: PlanningPlatform }>;`,
  );
  app = app.replace(
    `Ajoutez Instagram, YouTube ou TikTok depuis les réglages pour pouvoir publier.`,
    `Ajoutez Facebook, Instagram, YouTube ou TikTok depuis les réglages pour pouvoir publier.`,
  );
  app = app.replace(
    `const writerSupported = Boolean(writerDraft && !(writerDraft.platform === 'instagram' && writerDraft.format === 'story'));`,
    `const writerSupported = Boolean(writerDraft && writerDraft.platform !== 'facebook' && !(writerDraft.platform === 'instagram' && writerDraft.format === 'story'));`,
  );
  app = app.replace(
    `(['instagram', 'youtube', 'tiktok'] as PlanningPlatform[])`,
    `(['instagram', 'facebook', 'youtube', 'tiktok'] as PlanningPlatform[])`,
  );

  const inboxBefore = `              onOpenPublication={(context) => {\n                const publication = publications.find((candidate) => candidate.providerExternalId === context.externalContentId || candidate.targets.some((target) => target.externalId === context.externalContentId) || (context.url && candidate.externalUrl === context.url));\n                if (publication) {\n                  void editPublication(publication);\n                  navigate('planner');\n                  return;\n                }\n                if (context.url) {\n                  window.open(context.url, '_blank', 'noopener,noreferrer');\n                  return;\n                }\n                setToast('Cette publication n’est pas encore disponible dans le Planner.');\n              }}`;
  const inboxAfter = `              onOpenPublication={(context) => {\n                const publication = publications.find((candidate) => candidate.providerExternalId === context.externalContentId || candidate.targets.some((target) => target.externalId === context.externalContentId) || (context.url && candidate.externalUrl === context.url));\n                if (publication) {\n                  editPublication(publication);\n                  return;\n                }\n                const contextPlatform = selectedConversation?.platform === 'linkedin' ? undefined : selectedConversation?.platform as PlanningPlatform | undefined;\n                if (contextPlatform) {\n                  const body = context.body?.trim() || context.title?.trim() || 'Publication synchronisée';\n                  const eventAt = context.publishedAt || new Date().toISOString();\n                  const format = contextPlatform === 'youtube' ? 'video' : contextPlatform === 'tiktok' ? 'photo' : 'post';\n                  const targetFields = contextPlatform === 'facebook' ? { message: body } : contextPlatform === 'instagram' ? { caption: body } : {};\n                  editPublication({\n                    id: \`provider-context:\${context.externalContentId || encodeURIComponent(context.url || eventAt)}\`,\n                    body,\n                    status: 'completed',\n                    scheduledAt: eventAt,\n                    version: 1,\n                    createdAt: eventAt,\n                    updatedAt: eventAt,\n                    targets: [{\n                      id: \`provider-context-target:\${context.externalContentId || eventAt}\`,\n                      connectionId: selectedConversation?.connectionId,\n                      platform: contextPlatform,\n                      status: 'published',\n                      displayName: selectedConversation?.accountName || platformLabel(contextPlatform),\n                      format,\n                      fields: targetFields,\n                      connected: true,\n                      connectionStatus: 'connected',\n                      externalId: context.externalContentId,\n                      externalUrl: context.url,\n                    }],\n                    source: 'provider',\n                    readOnly: true,\n                    externalUrl: context.url,\n                    previewUrl: context.previewUrl,\n                    providerExternalId: context.externalContentId,\n                    providerMediaType: context.mediaType,\n                    providerEditable: false,\n                    providerStatus: 'published',\n                  });\n                  return;\n                }\n                setToast('Cette publication ne peut pas encore être affichée dans le volet.');\n              }}`;
  app = replaceOnce(app, inboxBefore, inboxAfter, 'Inbox publication opens internal drawer');

  app = app.replace(
    `{editingPublication?.readOnly && !editingPublication.providerEditable && <small className="sc16-provider-limit"><AlertTriangle size={13} /> Aperçu et contenu synchronisés. Meta ne permet pas de modifier via API une publication Instagram déjà publiée.</small>}`,
    `{editingPublication?.readOnly && !editingPublication.providerEditable && <small className="sc16-provider-limit"><AlertTriangle size={13} /> Aperçu et contenu synchronisés. {editingPublication.targets[0]?.platform === 'facebook' ? 'Cette publication Facebook est consultable ici sans être modifiée.' : 'Meta ne permet pas de modifier via API une publication Instagram déjà publiée.'}</small>}`,
  );

  app += '\n/* SC_FACEBOOK_PUBLISHING_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('Facebook publishing and always-internal publication drawer applied.');
