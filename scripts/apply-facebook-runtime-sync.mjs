import fs from 'node:fs';

// Facebook tokens are stored outside oauth_credentials but share the same crypto context type.
const tokenPath = 'src/worker/token-vault.ts';
let token = fs.readFileSync(tokenPath, 'utf8');
token = token.replace(
  "export type OAuthProvider = 'instagram' | 'youtube' | 'tiktok';",
  "export type OAuthProvider = 'instagram' | 'facebook' | 'youtube' | 'tiktok';",
);
fs.writeFileSync(tokenPath, token);

// Inbox queries currently join only social_connections; Facebook is intentionally stored separately.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
liveData = liveData.replace(
  "export type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';",
  "export type SocialPlatform = 'instagram' | 'facebook' | 'youtube' | 'tiktok';",
);
liveData = liveData.replace(
  "const platforms = new Set<SocialPlatform>(['instagram', 'youtube', 'tiktok']);",
  "const platforms = new Set<SocialPlatform>(['instagram', 'facebook', 'youtube', 'tiktok']);",
);
liveData = liveData.replaceAll(
  'JOIN social_connections sc ON sc.id = c.connection_id AND sc.workspace_id = c.workspace_id',
  `JOIN (\n       SELECT id, workspace_id, platform, display_name FROM social_connections\n       UNION ALL\n       SELECT id, workspace_id, 'facebook' AS platform, display_name FROM facebook_connections\n     ) sc ON sc.id = c.connection_id AND sc.workspace_id = c.workspace_id`,
);
if (!liveData.includes("'facebook' AS platform")) {
  throw new Error('Facebook runtime sync patch failed: Inbox account union was not applied.');
}
liveData += liveData.includes('SC_FACEBOOK_RUNTIME_LIVE_DATA_V1') ? '' : '\n// SC_FACEBOOK_RUNTIME_LIVE_DATA_V1\n';
fs.writeFileSync(liveDataPath, liveData);

// Hono API: sync Facebook read-through on Planner/Inbox access and expose cached Page posts.
const workerPath = 'src/worker/index.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes("from './facebook-runtime-sync'")) {
  const importAnchor = "import { persistSocialEvent } from './persistence';";
  if (!worker.includes(importAnchor)) throw new Error('Facebook runtime sync patch failed: worker import anchor missing.');
  worker = worker.replace(importAnchor, `${importAnchor}\nimport { listFacebookPlannerPublications, syncWorkspaceFacebookRuntime } from './facebook-runtime-sync';`);
}

const inboxSyncAnchor = `      const providerSync = await syncWorkspaceProviderComments(c.env.DB, c.env, principal.workspaceId).catch((error) => {\n        console.warn(JSON.stringify({ event: 'provider_inbox_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n        return undefined;\n      });`;
if (worker.includes(inboxSyncAnchor) && !worker.includes("event: 'facebook_runtime_inbox_sync_failed'")) {
  worker = worker.replace(inboxSyncAnchor, `${inboxSyncAnchor}\n      const facebookSync = await syncWorkspaceFacebookRuntime(c.env.DB, c.env, principal.workspaceId).catch((error) => {\n        console.warn(JSON.stringify({ event: 'facebook_runtime_inbox_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n        return undefined;\n      });`);
  worker = worker.replace(
    '      return c.json({ ...payload, providerSync });',
    '      return c.json({ ...payload, providerSync, facebookSync });',
  );
}

const plannerAnchor = `    const sync = await syncWorkspacePlannerHistory(c.env.DB, c.env, principal.workspaceId);\n    const publications = await listRemotePlannerPublications(c.env.DB, principal.workspaceId);\n    return c.json({ publications, sync });`;
if (worker.includes(plannerAnchor)) {
  worker = worker.replace(plannerAnchor, `    const sync = await syncWorkspacePlannerHistory(c.env.DB, c.env, principal.workspaceId);\n    const facebookSync = await syncWorkspaceFacebookRuntime(c.env.DB, c.env, principal.workspaceId).catch((error) => {\n      console.warn(JSON.stringify({ event: 'facebook_runtime_planner_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n      return undefined;\n    });\n    const [providerPublications, facebookPublications] = await Promise.all([\n      listRemotePlannerPublications(c.env.DB, principal.workspaceId),\n      listFacebookPlannerPublications(c.env.DB, principal.workspaceId).catch((error) => {\n        console.warn(JSON.stringify({ event: 'facebook_runtime_history_read_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n        return [];\n      }),\n    ]);\n    const publications = [...providerPublications, ...facebookPublications]\n      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());\n    return c.json({ publications, sync, facebookSync });`);
}
if (!worker.includes('listFacebookPlannerPublications')) {
  throw new Error('Facebook runtime sync patch failed: Planner Facebook history was not wired.');
}
worker += worker.includes('SC_FACEBOOK_RUNTIME_WORKER_V1') ? '' : '\n// SC_FACEBOOK_RUNTIME_WORKER_V1\n';
fs.writeFileSync(workerPath, worker);

// Poll in the existing one-minute cron as a safety net, in addition to read-through sync.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes("from './facebook-runtime-sync'")) {
  const importAnchor = "import { persistSocialEvent } from './persistence';";
  if (!production.includes(importAnchor)) throw new Error('Facebook runtime sync patch failed: production import anchor missing.');
  production = production.replace(importAnchor, `${importAnchor}\nimport { syncAllFacebookRuntime } from './facebook-runtime-sync';`);
}
const scheduledAnchor = `    try {\n      await dispatchPending(env);`;
if (production.includes(scheduledAnchor) && !production.includes("event: 'facebook_runtime_sync_sweep'")) {
  production = production.replace(scheduledAnchor, `    try {\n      const facebookSync = await syncAllFacebookRuntime(env.DB, env);\n      if (facebookSync.synced > 0 || facebookSync.failed > 0) {\n        console.log(JSON.stringify({ event: 'facebook_runtime_sync_sweep', ...facebookSync }));\n      }\n    } catch (error) {\n      console.error(JSON.stringify({\n        event: 'facebook_runtime_sync_sweep_failed',\n        message: error instanceof Error ? error.message : 'unknown',\n      }));\n    }\n\n    try {\n      await dispatchPending(env);`);
}
production += production.includes('SC_FACEBOOK_RUNTIME_CRON_V1') ? '' : '\n// SC_FACEBOOK_RUNTIME_CRON_V1\n';
fs.writeFileSync(productionPath, production);

// UI: keep Facebook out of publishing platform types but allow it for connected accounts and Inbox.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes("type ConnectedPlatform = SocialPlatform | 'facebook';")) {
  const socialType = "type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';";
  if (!app.includes(socialType)) throw new Error('Facebook runtime sync patch failed: SocialPlatform type anchor missing.');
  app = app.replace(socialType, `${socialType}\ntype ConnectedPlatform = SocialPlatform | 'facebook';`);
}
app = app.replaceAll('platform: SocialPlatform;\n  displayName:', 'platform: ConnectedPlatform;\n  displayName:');
app = app.replaceAll('platform: SocialPlatform;\n  accountName?:', 'platform: ConnectedPlatform;\n  accountName?:');
app = app.replace('function platformLabel(platform: SocialPlatform) {', 'function platformLabel(platform: ConnectedPlatform) {');
app = app.replace('function PlatformMark({ platform, size = 16 }: { platform: SocialPlatform; size?: number }) {', 'function PlatformMark({ platform, size = 16 }: { platform: ConnectedPlatform; size?: number }) {');
if (!app.includes("if (platform === 'facebook') return 'Facebook';")) {
  app = app.replace(
    "  if (platform === 'instagram') return 'Instagram';",
    "  if (platform === 'instagram') return 'Instagram';\n  if (platform === 'facebook') return 'Facebook';",
  );
}
if (!app.includes("platform === 'facebook'\n    ? <MessageCircle")) {
  app = app.replace(
    "  const icon = platform === 'instagram'",
    "  const icon = platform === 'facebook'\n    ? <MessageCircle size={size} />\n    : platform === 'instagram'",
  );
}
if (!app.includes("if (platform === 'facebook') return 'Facebook';")) {
  throw new Error('Facebook runtime sync patch failed: Facebook label was not applied.');
}
app += app.includes('SC_FACEBOOK_RUNTIME_UI_V1') ? '' : '\n/* SC_FACEBOOK_RUNTIME_UI_V1 */\n';
fs.writeFileSync(appPath, app);

console.log('Facebook posts, comments and Messenger history are wired into Planner and Inbox.');
