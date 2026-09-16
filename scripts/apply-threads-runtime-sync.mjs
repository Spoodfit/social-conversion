import fs from 'node:fs';

function requiredReplace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Threads runtime patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Worker: read-through sync for Planner and Inbox.
const workerPath = 'src/worker/index.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('SC_THREADS_RUNTIME_WORKER_V1')) {
  const importAnchor = `import { persistSocialEvent } from './persistence';`;
  worker = requiredReplace(
    worker,
    importAnchor,
    `${importAnchor}\nimport { listThreadsPlannerPublications, syncWorkspaceThreadsRuntime } from './threads-runtime-sync';`,
    'worker import',
  );

  const inboxAnchor = `      const payload = await listInboxConversations(`;
  worker = requiredReplace(
    worker,
    inboxAnchor,
    `      const threadsSync = await syncWorkspaceThreadsRuntime(\n        c.env.DB,\n        c.env,\n        principal.workspaceId,\n        fetch,\n        c.req.query('refresh') === '1',\n      ).catch((error) => {\n        console.warn(JSON.stringify({ event: 'threads_runtime_inbox_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n        return undefined;\n      });\n\n${inboxAnchor}`,
    'Inbox read-through sync',
  );
  worker = requiredReplace(
    worker,
    `      return c.json({ ...payload, providerSync, facebookSync, linkedinSync });`,
    `      return c.json({ ...payload, providerSync, facebookSync, linkedinSync, threadsSync });`,
    'Inbox response sync status',
  );

  const plannerListAnchor = `    const [providerPublications, facebookPublications, linkedinPublications] = await Promise.all([`;
  worker = requiredReplace(
    worker,
    plannerListAnchor,
    `    const threadsSync = await syncWorkspaceThreadsRuntime(c.env.DB, c.env, principal.workspaceId).catch((error) => {\n      console.warn(JSON.stringify({ event: 'threads_runtime_planner_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n      return undefined;\n    });\n${plannerListAnchor.replace('] =', ', threadsPublications] =')}`,
    'Planner Threads sync',
  );
  worker = requiredReplace(
    worker,
    `      listLinkedInPlannerPublications(c.env.DB, principal.workspaceId).catch((error) => {\n        console.warn(JSON.stringify({ event: 'linkedin_community_history_read_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n        return [];\n      }),\n    ]);\n    const publications = [...providerPublications, ...facebookPublications, ...linkedinPublications]`,
    `      listLinkedInPlannerPublications(c.env.DB, principal.workspaceId).catch((error) => {\n        console.warn(JSON.stringify({ event: 'linkedin_community_history_read_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n        return [];\n      }),\n      listThreadsPlannerPublications(c.env.DB, principal.workspaceId).catch((error) => {\n        console.warn(JSON.stringify({ event: 'threads_runtime_history_read_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n        return [];\n      }),\n    ]);\n    const publications = [...providerPublications, ...facebookPublications, ...linkedinPublications, ...threadsPublications]`,
    'Planner Threads history',
  );
  worker = requiredReplace(
    worker,
    `return c.json({ publications, sync, facebookSync, linkedinSync });`,
    `return c.json({ publications, sync, facebookSync, linkedinSync, threadsSync });`,
    'Planner response sync status',
  );

  worker += '\n// SC_THREADS_RUNTIME_WORKER_V1\n';
  fs.writeFileSync(workerPath, worker);
}

// Inbox queries: resolve conversations whose connection lives in threads_connections.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_THREADS_RUNTIME_LIVE_DATA_V1')) {
  liveData = requiredReplace(
    liveData,
    `export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'tiktok';`,
    `export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin' | 'threads' | 'youtube' | 'tiktok';`,
    'Inbox platform union',
  );
  liveData = requiredReplace(
    liveData,
    `const platforms = new Set<SocialPlatform>(['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok']);`,
    `const platforms = new Set<SocialPlatform>(['instagram', 'facebook', 'linkedin', 'threads', 'youtube', 'tiktok']);`,
    'Inbox platform filter',
  );
  const unionAnchor = `SELECT id, workspace_id, platform, display_name FROM social_connections\n       UNION ALL\n       SELECT id, workspace_id, 'facebook' AS platform, display_name FROM facebook_connections\n       UNION ALL\n       SELECT id, workspace_id, 'linkedin' AS platform, display_name FROM linkedin_organization_connections`;
  if (!liveData.includes(unionAnchor)) throw new Error('Threads runtime patch failed: Inbox connection union anchor not found.');
  liveData = liveData.replaceAll(
    unionAnchor,
    `${unionAnchor}\n       UNION ALL\n       SELECT id, workspace_id, 'threads' AS platform, display_name FROM threads_connections`,
  );
  liveData += '\n// SC_THREADS_RUNTIME_LIVE_DATA_V1\n';
  fs.writeFileSync(liveDataPath, liveData);
}

// Cron: keep Threads data fresh even if nobody opens Planner or Inbox.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('SC_THREADS_RUNTIME_CRON_V1')) {
  const importAnchor = `import { persistSocialEvent } from './persistence';`;
  production = requiredReplace(
    production,
    importAnchor,
    `${importAnchor}\nimport { syncAllThreadsRuntime } from './threads-runtime-sync';`,
    'production import',
  );
  const scheduledAnchor = `    try {\n      await dispatchPending(env);`;
  production = requiredReplace(
    production,
    scheduledAnchor,
    `    try {\n      const threadsRuntimeSync = await syncAllThreadsRuntime(env.DB, env);\n      if (threadsRuntimeSync.synced > 0 || threadsRuntimeSync.failed > 0) {\n        console.log(JSON.stringify({ event: 'threads_runtime_sync_sweep', ...threadsRuntimeSync }));\n      }\n    } catch (error) {\n      console.error(JSON.stringify({ event: 'threads_runtime_sync_sweep_failed', message: error instanceof Error ? error.message : 'unknown' }));\n    }\n\n${scheduledAnchor}`,
    'scheduled sync',
  );
  production += '\n// SC_THREADS_RUNTIME_CRON_V1\n';
  fs.writeFileSync(productionPath, production);
}

// UI is already Threads-aware for connected accounts. Ensure Inbox conversation platform can carry it.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_THREADS_RUNTIME_UI_V1')) {
  if (!app.includes("type ConnectedPlatform = SocialPlatform | 'facebook' | 'linkedin' | 'threads';")) {
    throw new Error('Threads runtime patch failed: ConnectedPlatform does not contain Threads.');
  }
  if (!app.includes("if (platform === 'threads') return 'Threads';")) {
    throw new Error('Threads runtime patch failed: Threads label is missing.');
  }
  app += '\n/* SC_THREADS_RUNTIME_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('Threads posts, replies and mentions are wired into Planner and Inbox.');
