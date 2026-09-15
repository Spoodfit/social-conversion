import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`YouTube publishing patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Queue consumer + minute sweep.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes("from './youtube-publishing'")) {
  production = replaceOnce(
    production,
    `import type { NormalizedSocialEvent } from '../shared/types';\n\ntype ProductionQueueMessage = NormalizedSocialEvent | OutboundDeliveryEnvelope;`,
    `import type { NormalizedSocialEvent } from '../shared/types';\nimport {\n  enqueuePendingYouTubePublicationSyncs,\n  isYouTubeSyncEnvelope,\n  processYouTubePublicationSync,\n  YouTubePublishingError,\n  type YouTubeSyncEnvelope,\n} from './youtube-publishing';\n\ntype ProductionQueueMessage = NormalizedSocialEvent | OutboundDeliveryEnvelope | YouTubeSyncEnvelope;`,
    'production imports and queue type',
  );

  production = replaceOnce(
    production,
    `    for (const message of batch.messages) {\n      if (isOutboundEnvelope(message.body)) {`,
    `    for (const message of batch.messages) {\n      if (isYouTubeSyncEnvelope(message.body)) {\n        try {\n          const result = await processYouTubePublicationSync(env, message.body);\n          console.log(JSON.stringify({ event: 'youtube_publication_sync_processed', workspaceId: message.body.workspaceId, postId: message.body.postId, ...result }));\n          message.ack();\n        } catch (error) {\n          console.error(JSON.stringify({\n            event: 'youtube_publication_sync_failed',\n            workspaceId: message.body.workspaceId,\n            postId: message.body.postId,\n            retryable: error instanceof YouTubePublishingError ? error.retryable : true,\n            message: error instanceof Error ? error.message : 'unknown',\n          }));\n          if (error instanceof YouTubePublishingError && !error.retryable) message.ack();\n          else message.retry({ delaySeconds: 60 });\n        }\n        continue;\n      }\n\n      if (isOutboundEnvelope(message.body)) {`,
    'youtube queue consumer',
  );

  production = replaceOnce(
    production,
    `    try {\n      await dispatchPending(env);`,
    `    try {\n      const queued = await enqueuePendingYouTubePublicationSyncs(env, 20);\n      if (queued > 0) console.log(JSON.stringify({ event: 'youtube_publication_sync_sweep', queued }));\n    } catch (error) {\n      console.error(JSON.stringify({\n        event: 'youtube_publication_sync_sweep_failed',\n        message: error instanceof Error ? error.message : 'unknown',\n      }));\n    }\n\n    try {\n      await dispatchPending(env);`,
    'youtube scheduled sweep',
  );

  fs.writeFileSync(productionPath, production);
}

// 2) Planner API lifecycle -> queue.
const cockpitPath = 'src/worker/cockpit-production.ts';
let cockpit = fs.readFileSync(cockpitPath, 'utf8');
if (!cockpit.includes("from './youtube-publishing'")) {
  cockpit = replaceOnce(
    cockpit,
    `import { updatePublication } from './publishing-update';`,
    `import { updatePublication } from './publishing-update';\nimport { enqueueYouTubePublicationSync, youtubePublishingConfigured } from './youtube-publishing';`,
    'cockpit youtube import',
  );

  cockpit = replaceOnce(
    cockpit,
    `      await writeAuditLog(env.DB, auth.principal, 'publication.scheduled', 'content_post', publication.id, {\n        scheduledAt: publication.scheduledAt,\n        targetCount: publication.targets.length,\n      });\n      return Response.json({ publication }, { status: 201 });`,
    `      await writeAuditLog(env.DB, auth.principal, 'publication.scheduled', 'content_post', publication.id, {\n        scheduledAt: publication.scheduledAt,\n        targetCount: publication.targets.length,\n      });\n      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publication.id);\n      return Response.json({ publication }, { status: 201 });`,
    'enqueue on create',
  );

  cockpit = replaceOnce(
    cockpit,
    `      await writeAuditLog(env.DB, auth.principal, 'publication.updated', 'content_post', publicationId, {\n        scheduledAt: publication.scheduledAt,\n        targetCount: publication.targets.length,\n        version: publication.version,\n      });\n      return Response.json({ publication });`,
    `      await writeAuditLog(env.DB, auth.principal, 'publication.updated', 'content_post', publicationId, {\n        scheduledAt: publication.scheduledAt,\n        targetCount: publication.targets.length,\n        version: publication.version,\n      });\n      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publicationId);\n      return Response.json({ publication });`,
    'enqueue on update',
  );

  cockpit = replaceOnce(
    cockpit,
    `      await writeAuditLog(env.DB, auth.principal, 'publication.rescheduled', 'content_post', publicationId, {\n        scheduledAt: publication.scheduledAt,\n        version: publication.version,\n      });\n      return Response.json({ publication });`,
    `      await writeAuditLog(env.DB, auth.principal, 'publication.rescheduled', 'content_post', publicationId, {\n        scheduledAt: publication.scheduledAt,\n        version: publication.version,\n      });\n      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publicationId);\n      return Response.json({ publication });`,
    'enqueue on reschedule',
  );

  cockpit = replaceOnce(
    cockpit,
    `      await writeAuditLog(env.DB, auth.principal, 'publication.cancelled', 'content_post', publicationId, {\n        version: publication.version,\n      });\n      return Response.json({ publication });`,
    `      await writeAuditLog(env.DB, auth.principal, 'publication.cancelled', 'content_post', publicationId, {\n        version: publication.version,\n      });\n      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publicationId);\n      return Response.json({ publication });`,
    'enqueue on cancel',
  );

  cockpit = replaceOnce(
    cockpit,
    `          contentPublishingReady: false,\n          mediaLibraryReady: isLive(env),`,
    `          contentPublishingReady: false,\n          youtubePublishingReady: isLive(env) && youtubePublishingConfigured(env),\n          mediaLibraryReady: isLive(env),`,
    'runtime YouTube publishing readiness',
  );

  fs.writeFileSync(cockpitPath, cockpit);
}

// 3) Expose provider sync state with publications.
const publishingPath = 'src/worker/publishing.ts';
let publishing = fs.readFileSync(publishingPath, 'utf8');
if (!publishing.includes('remote_sync_status')) {
  publishing = replaceOnce(
    publishing,
    `  connection_status: string | null;\n};`,
    `  connection_status: string | null;\n  remote_sync_status: string | null;\n  remote_external_id: string | null;\n  remote_external_url: string | null;\n  remote_sync_error: string | null;\n  remote_synced_at: string | null;\n};`,
    'publishing join type',
  );

  publishing = replaceOnce(
    publishing,
    `       sc.handle AS connected_handle,\n       sc.status AS connection_status\n     FROM content_posts p\n     LEFT JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id\n     LEFT JOIN social_connections sc ON sc.id = d.connection_id AND sc.workspace_id = p.workspace_id`,
    `       sc.handle AS connected_handle,\n       sc.status AS connection_status,\n       rs.sync_status AS remote_sync_status,\n       rs.external_id AS remote_external_id,\n       rs.external_url AS remote_external_url,\n       rs.last_error AS remote_sync_error,\n       rs.synced_at AS remote_synced_at\n     FROM content_posts p\n     LEFT JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id\n     LEFT JOIN social_connections sc ON sc.id = d.connection_id AND sc.workspace_id = p.workspace_id\n     LEFT JOIN publication_remote_sync rs\n       ON rs.workspace_id = p.workspace_id AND rs.post_id = p.id\n       AND rs.connection_id = d.connection_id AND rs.platform = d.platform`,
    'publishing remote sync join',
  );

  publishing = replaceOnce(
    publishing,
    `      connectionStatus?: string;\n    }>;`,
    `      connectionStatus?: string;\n      syncStatus?: string;\n      externalId?: string;\n      externalUrl?: string;\n      syncError?: string;\n      syncedAt?: string;\n    }>;`,
    'publication target sync shape',
  );

  publishing = replaceOnce(
    publishing,
    `        connected: Boolean(row.connection_id && row.connection_status === 'connected'),\n        connectionStatus: row.connection_status ?? undefined,`,
    `        connected: Boolean(row.connection_id && row.connection_status === 'connected'),\n        connectionStatus: row.connection_status ?? undefined,\n        syncStatus: row.remote_sync_status ?? undefined,\n        externalId: row.remote_external_id ?? undefined,\n        externalUrl: row.remote_external_url ?? undefined,\n        syncError: row.remote_sync_error ?? undefined,\n        syncedAt: row.remote_synced_at ?? undefined,`,
    'publication target sync mapping',
  );

  fs.writeFileSync(publishingPath, publishing);
}

// 4) UI state in the existing modification drawer.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('youtubePublishingReady?: boolean;')) {
  app = app.replace('  contentPublishingReady?: boolean;\n', '  contentPublishingReady?: boolean;\n  youtubePublishingReady?: boolean;\n');
}
if (!app.includes('syncStatus?: string;')) {
  app = replaceOnce(
    app,
    `  connected: boolean;\n  connectionStatus?: string;\n};`,
    `  connected: boolean;\n  connectionStatus?: string;\n  syncStatus?: string;\n  externalId?: string;\n  externalUrl?: string;\n  syncError?: string;\n  syncedAt?: string;\n};`,
    'frontend target sync type',
  );
}
if (!app.includes('sc11-youtube-sync')) {
  app = replaceOnce(
    app,
    `  const activePreviewDestination = previewDestinations[Math.min(Math.max(previewIndex, 0), Math.max(0, previewDestinations.length - 1))];`,
    `  const activePreviewDestination = previewDestinations[Math.min(Math.max(previewIndex, 0), Math.max(0, previewDestinations.length - 1))];\n  const youtubeTarget = editingPublication?.targets.find((target) => target.platform === 'youtube');\n  const youtubeSyncLabel = youtubeTarget?.syncStatus === 'scheduled' ? 'Programmé sur YouTube'\n    : youtubeTarget?.syncStatus === 'uploaded' ? 'Envoyé sur YouTube'\n      : youtubeTarget?.syncStatus === 'syncing' || youtubeTarget?.syncStatus === 'queued' ? 'Synchronisation YouTube…'\n        : youtubeTarget?.syncStatus === 'failed' ? 'Erreur de synchronisation YouTube'\n          : undefined;`,
    'frontend youtube sync state',
  );

  app = replaceOnce(
    app,
    `<span className="sc8-status-dot"><i /> {editingPublication ? 'Publication planifiée' : 'Nouvelle publication'}</span>`,
    `<span className="sc8-status-dot"><i /> {editingPublication ? 'Publication planifiée' : 'Nouvelle publication'}</span>{youtubeSyncLabel && <span className={\`sc11-youtube-sync \${youtubeTarget?.syncStatus ?? ''}\`}>{youtubeSyncLabel}</span>}`,
    'drawer youtube sync badge',
  );

  app = replaceOnce(
    app,
    `<div className="sc8-hero-destinations">`,
    `{youtubeTarget?.syncError && <div className="sc11-youtube-error"><AlertTriangle size={13} /> {youtubeTarget.syncError}</div>}\n        <div className="sc8-hero-destinations">`,
    'drawer youtube sync error',
  );

  fs.writeFileSync(appPath, app);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./youtube-sync.css")) {
  main += "\nimport './youtube-sync.css';\n";
  fs.writeFileSync(mainPath, main);
}

console.log('Real YouTube publishing lifecycle applied.');
