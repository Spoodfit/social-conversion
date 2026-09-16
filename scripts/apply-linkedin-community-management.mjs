import fs from 'node:fs';

function requiredReplace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`LinkedIn Community patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Add organization comment replies to the Community runtime.
const communityPath = 'src/worker/linkedin-community.ts';
let community = fs.readFileSync(communityPath, 'utf8');
if (!community.includes('SC_LINKEDIN_COMMUNITY_REPLY_V1')) {
  community += `

export async function replyLinkedInOrganizationComment(
  db: D1Database,
  env: Env,
  workspaceId: string,
  conversationId: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
) {
  const body = message.trim();
  if (!body || body.length > 1250) throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', 'La réponse LinkedIn doit contenir entre 1 et 1250 caractères.');
  const row = await db.prepare(
    \`SELECT lc.id, lc.workspace_id, lc.external_account_id, lc.organization_urn, lc.display_name, lc.handle,
            lc.scopes_json, lc.access_token_ciphertext, lc.access_token_iv, lc.access_key_version,
            (SELECT m.context_json FROM messages m
             WHERE m.conversation_id = c.id AND m.message_type = 'comment' AND m.direction = 'inbound'
             ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS context_json
     FROM conversations c
     JOIN linkedin_organization_connections lc ON lc.id = c.connection_id AND lc.workspace_id = c.workspace_id
     WHERE c.id = ? AND c.workspace_id = ? AND lc.status = 'connected'
     LIMIT 1\`,
  ).bind(conversationId, workspaceId).first<OrganizationConnection & { context_json: string | null }>();
  if (!row) throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', 'Conversation LinkedIn introuvable ou Page déconnectée.');
  const scopes = parseScopes(row.scopes_json);
  if (!scopes.includes('w_organization_social_feed') && !scopes.includes('w_organization_social')) {
    throw new LinkedInCommunityError('COMMUNITY_ACCESS_REQUIRED', 'LinkedIn n’a pas accordé le droit de répondre aux commentaires de cette Page.');
  }
  let context: { externalPostId?: unknown; commentUrn?: unknown } = {};
  try {
    const parsed = JSON.parse(row.context_json ?? '{}') as unknown;
    if (parsed && typeof parsed === 'object') context = parsed as typeof context;
  } catch {
    context = {};
  }
  const postId = str(context.externalPostId, 500);
  const commentUrn = str(context.commentUrn, 700);
  if (!postId || !commentUrn) throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', 'Le commentaire LinkedIn d’origine ne peut pas être identifié.');
  const token = await accessToken(env, row);
  const url = \`https://api.linkedin.com/rest/socialActions/\${encodeURIComponent(commentUrn)}/comments\`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: restHeaders(token, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      actor: row.organization_urn,
      object: postId,
      parentComment: commentUrn,
      message: { text: body },
    }),
  });
  const responseText = await response.text().catch(() => '');
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new LinkedInCommunityError('COMMUNITY_ACCESS_REQUIRED', \`LinkedIn a refusé la réponse (\${response.status}).\`);
    }
    throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', \`LinkedIn a refusé la réponse (\${response.status})\${responseText ? ': ' + responseText.slice(0, 500) : ''}\`);
  }
  await syncWorkspaceLinkedInCommunity(db, env, workspaceId, fetchImpl, true).catch(() => undefined);
  return { sent: true };
}

// SC_LINKEDIN_COMMUNITY_REPLY_V1
`;
  fs.writeFileSync(communityPath, community);
}

// 2) Production OAuth dispatch, comment replies and conservative polling.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('SC_LINKEDIN_COMMUNITY_PRODUCTION_V1')) {
  const importAnchor = `} from './linkedin-oauth';`;
  production = requiredReplace(production, importAnchor, `${importAnchor}
import {
  completeLinkedInCommunityOAuth,
  isLinkedInCommunityState,
  LinkedInCommunityError,
  linkedinCommunityConfigured,
  replyLinkedInOrganizationComment,
  startLinkedInCommunityOAuth,
  syncAllLinkedInCommunity,
} from './linkedin-community';`, 'production Community import');

  const dispatchAnchor = 'async function dispatchPending(env: Env): Promise<number> {';
  production = requiredReplace(production, dispatchAnchor, `function linkedinCommunityRedirect(env: Env, outcome: 'connected' | 'error' | 'access-required'): string {
  const configured = Reflect.get(env, 'LINKEDIN_REDIRECT_URI');
  try {
    const base = new URL(typeof configured === 'string' ? configured : 'https://social.neptunebusiness.com/');
    base.pathname = '/';
    base.search = '?oauth=linkedin-community-' + outcome;
    base.hash = '';
    return base.toString();
  } catch {
    return 'https://social.neptunebusiness.com/?oauth=linkedin-community-' + outcome;
  }
}

async function handleLinkedInCommunityStart(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateMutation(request, env, '/api/oauth/linkedin/community/start');
  if (!auth.ok) return auth.response;
  if (auth.principal.role !== 'admin' && auth.principal.role !== 'manager') {
    return Response.json({ error: 'Seuls les administrateurs ou managers peuvent connecter une Page LinkedIn.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
  }
  if (env.DEMO_MODE === 'true' || !linkedinCommunityConfigured(env)) {
    return Response.json({ error: 'La connexion LinkedIn Pages n’est pas disponible.', code: 'OAUTH_NOT_CONFIGURED' }, { status: 503 });
  }
  try {
    return Response.json(await startLinkedInCommunityOAuth(env.DB, env, auth.principal), { status: 201 });
  } catch (error) {
    if (error instanceof LinkedInCommunityError) return Response.json({ error: error.message, code: error.code }, { status: 502 });
    throw error;
  }
}

async function handleLinkedInCommentReply(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateMutation(request, env, '/api/linkedin/comments/reply');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => undefined) as { conversationId?: unknown; message?: unknown } | undefined;
  if (!body || typeof body.conversationId !== 'string' || typeof body.message !== 'string') {
    return Response.json({ error: 'conversationId et message sont requis.', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  try {
    return Response.json(await replyLinkedInOrganizationComment(env.DB, env, auth.principal.workspaceId, body.conversationId, body.message));
  } catch (error) {
    if (error instanceof LinkedInCommunityError) {
      const status = error.code === 'COMMUNITY_ACCESS_REQUIRED' ? 403 : 502;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}

${dispatchAnchor}`, 'Community handlers');

  const oldCallbackStart = `async function handleLinkedInOAuthCallback(url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (url.searchParams.has('error') || !state || !code) {
    return Response.redirect(linkedinOauthRedirect(env, 'error'), 302);
  }
  try {`;
  const newCallbackStart = `async function handleLinkedInOAuthCallback(url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const communityState = state ? await isLinkedInCommunityState(env.DB, state).catch(() => false) : false;
  if (url.searchParams.has('error') || !state || !code) {
    return Response.redirect(communityState ? linkedinCommunityRedirect(env, 'error') : linkedinOauthRedirect(env, 'error'), 302);
  }
  if (communityState) {
    try {
      await completeLinkedInCommunityOAuth(env.DB, env, { state, code });
      return new Response(null, { status: 302, headers: { location: linkedinCommunityRedirect(env, 'connected'), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
    } catch (error) {
      console.warn(JSON.stringify({ event: 'linkedin_community_oauth_callback_failed', code: error instanceof LinkedInCommunityError ? error.code : 'unknown' }));
      const outcome = error instanceof LinkedInCommunityError && error.code === 'COMMUNITY_ACCESS_REQUIRED' ? 'access-required' : 'error';
      return new Response(null, { status: 302, headers: { location: linkedinCommunityRedirect(env, outcome), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
    }
  }
  try {`;
  production = requiredReplace(production, oldCallbackStart, newCallbackStart, 'shared LinkedIn callback');

  const personalStartRoute = `    if (url.pathname === '/api/oauth/linkedin/start' && request.method === 'POST') {
      return handleLinkedInOAuthStart(request, env);
    }`;
  production = requiredReplace(production, personalStartRoute, `    if (url.pathname === '/api/oauth/linkedin/community/start' && request.method === 'POST') {
      return handleLinkedInCommunityStart(request, env);
    }
    if (url.pathname === '/api/linkedin/comments/reply' && request.method === 'POST') {
      return handleLinkedInCommentReply(request, env);
    }
${personalStartRoute}`, 'Community routes');

  const scheduledAnchor = `    try {
      const linkedinPublicationQueued = await enqueuePendingLinkedInPublicationSyncs(env, 20);`;
  production = requiredReplace(production, scheduledAnchor, `    try {
      const linkedinCommunitySync = await syncAllLinkedInCommunity(env.DB, env);
      if (linkedinCommunitySync.synced > 0 || linkedinCommunitySync.failed > 0) {
        console.log(JSON.stringify({ event: 'linkedin_community_sync_sweep', ...linkedinCommunitySync }));
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'linkedin_community_sync_sweep_failed', message: error instanceof Error ? error.message : 'unknown' }));
    }

${scheduledAnchor}`, 'Community cron');

  production += '\n// SC_LINKEDIN_COMMUNITY_PRODUCTION_V1\n';
  fs.writeFileSync(productionPath, production);
}

// 3) Common connection switcher, Planner history and Inbox read-through sync.
const workerPath = 'src/worker/index.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('SC_LINKEDIN_COMMUNITY_WORKER_V1')) {
  const importAnchor = `import { listFacebookPlannerPublications, syncWorkspaceFacebookRuntime } from './facebook-runtime-sync';`;
  worker = requiredReplace(worker, importAnchor, `${importAnchor}
import { listLinkedInPlannerPublications, syncWorkspaceLinkedInCommunity } from './linkedin-community';`, 'worker Community import');

  const linkedInBootstrap = `       SELECT id, 'linkedin' AS platform, display_name, handle, status, last_synced_at
       FROM linkedin_connections
       WHERE workspace_id = ?
       ORDER BY platform, display_name\`,
    ).bind(principal.workspaceId, principal.workspaceId, principal.workspaceId),`;
  worker = requiredReplace(worker, linkedInBootstrap, `       SELECT id, 'linkedin' AS platform, display_name, handle, status, last_synced_at
       FROM linkedin_connections
       WHERE workspace_id = ?
       UNION ALL
       SELECT id, 'linkedin' AS platform, display_name, handle, status, last_synced_at
       FROM linkedin_organization_connections
       WHERE workspace_id = ?
       ORDER BY platform, display_name\`,
    ).bind(principal.workspaceId, principal.workspaceId, principal.workspaceId, principal.workspaceId),`, 'bootstrap LinkedIn Pages');

  const inboxPayloadAnchor = `      const payload = await listInboxConversations(`;
  worker = requiredReplace(worker, inboxPayloadAnchor, `      const linkedinSync = await syncWorkspaceLinkedInCommunity(
        c.env.DB,
        c.env,
        principal.workspaceId,
        fetch,
        c.req.query('refresh') === '1',
      ).catch((error) => {
        console.warn(JSON.stringify({ event: 'linkedin_community_inbox_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
        return undefined;
      });

${inboxPayloadAnchor}`, 'Inbox LinkedIn sync');
  worker = worker.replace(
    `      return c.json({ ...payload, providerSync, facebookSync });`,
    `      return c.json({ ...payload, providerSync, facebookSync, linkedinSync });`,
  );

  const plannerLists = `    const [providerPublications, facebookPublications] = await Promise.all([
      listRemotePlannerPublications(c.env.DB, principal.workspaceId),
      listFacebookPlannerPublications(c.env.DB, principal.workspaceId).catch((error) => {
        console.warn(JSON.stringify({ event: 'facebook_runtime_history_read_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
        return [];
      }),
    ]);
    const publications = [...providerPublications, ...facebookPublications]`;
  worker = requiredReplace(worker, plannerLists, `    const linkedinSync = await syncWorkspaceLinkedInCommunity(c.env.DB, c.env, principal.workspaceId).catch((error) => {
      console.warn(JSON.stringify({ event: 'linkedin_community_planner_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
      return undefined;
    });
    const [providerPublications, facebookPublications, linkedinPublications] = await Promise.all([
      listRemotePlannerPublications(c.env.DB, principal.workspaceId),
      listFacebookPlannerPublications(c.env.DB, principal.workspaceId).catch((error) => {
        console.warn(JSON.stringify({ event: 'facebook_runtime_history_read_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
        return [];
      }),
      listLinkedInPlannerPublications(c.env.DB, principal.workspaceId).catch((error) => {
        console.warn(JSON.stringify({ event: 'linkedin_community_history_read_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
        return [];
      }),
    ]);
    const publications = [...providerPublications, ...facebookPublications, ...linkedinPublications]`, 'Planner LinkedIn history');
  worker = worker.replace(`return c.json({ publications, sync, facebookSync });`, `return c.json({ publications, sync, facebookSync, linkedinSync });`);

  worker += '\n// SC_LINKEDIN_COMMUNITY_WORKER_V1\n';
  fs.writeFileSync(workerPath, worker);
}

// 4) Inbox queries can resolve LinkedIn Page connection IDs.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_LINKEDIN_COMMUNITY_LIVE_DATA_V1')) {
  liveData = liveData.replace(
    `export type SocialPlatform = 'instagram' | 'facebook' | 'youtube' | 'tiktok';`,
    `export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'tiktok';`,
  );
  liveData = liveData.replace(
    `const platforms = new Set<SocialPlatform>(['instagram', 'facebook', 'youtube', 'tiktok']);`,
    `const platforms = new Set<SocialPlatform>(['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok']);`,
  );
  const unionAnchor = `SELECT id, workspace_id, platform, display_name FROM social_connections
       UNION ALL
       SELECT id, workspace_id, 'facebook' AS platform, display_name FROM facebook_connections`;
  liveData = liveData.replaceAll(unionAnchor, `${unionAnchor}
       UNION ALL
       SELECT id, workspace_id, 'linkedin' AS platform, display_name FROM linkedin_organization_connections`);
  if (!liveData.includes("'linkedin' AS platform, display_name FROM linkedin_organization_connections")) {
    throw new Error('LinkedIn Community patch failed: Inbox connection union missing.');
  }
  liveData += '\n// SC_LINKEDIN_COMMUNITY_LIVE_DATA_V1\n';
  fs.writeFileSync(liveDataPath, liveData);
}

// 5) LinkedIn Pages become real publishing destinations using the existing LinkedIn queue adapter.
for (const path of ['src/worker/publishing-destinations.ts', 'src/worker/publishing.ts']) {
  let source = fs.readFileSync(path, 'utf8');
  if (!source.includes('SC_LINKEDIN_ORG_DESTINATIONS_V1')) {
    const profileUnion = `SELECT id, workspace_id, 'linkedin' AS platform, display_name, handle, status FROM linkedin_connections`;
    source = requiredReplace(source, profileUnion, `${profileUnion}
       UNION ALL
       SELECT id, workspace_id, 'linkedin' AS platform, display_name, handle, status FROM linkedin_organization_connections`, `${path} organization connection union`);
    source += '\n// SC_LINKEDIN_ORG_DESTINATIONS_V1\n';
    fs.writeFileSync(path, source);
  }
}

const linkedinPublishingPath = 'src/worker/linkedin-publishing.ts';
let linkedinPublishing = fs.readFileSync(linkedinPublishingPath, 'utf8');
if (!linkedinPublishing.includes('SC_LINKEDIN_ORG_PUBLISHING_V1')) {
  linkedinPublishing = requiredReplace(
    linkedinPublishing,
    `  person_id: string;
  connection_status: string;`,
    `  person_id: string;
  owner_urn: string;
  connection_kind: 'person' | 'organization';
  connection_status: string;`,
    'LinkedIn destination owner type',
  );
  linkedinPublishing = requiredReplace(
    linkedinPublishing,
    `function publicationVisibility(row: LinkedInDestinationRow): 'PUBLIC' | 'CONNECTIONS' {
  const fields = parseFields(row.fields_json);`,
    `function publicationVisibility(row: LinkedInDestinationRow): 'PUBLIC' | 'CONNECTIONS' {
  if (row.connection_kind === 'organization') return 'PUBLIC';
  const fields = parseFields(row.fields_json);`,
    'organization visibility',
  );
  linkedinPublishing = requiredReplace(
    linkedinPublishing,
    `            lc.external_account_id AS person_id, lc.status AS connection_status, lc.scopes_json,
            lc.access_token_ciphertext, lc.access_token_iv, lc.access_key_version
     FROM content_posts p
     JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id
     JOIN linkedin_connections lc ON lc.id = d.connection_id AND lc.workspace_id = d.workspace_id`,
    `            lc.external_account_id AS person_id, lc.owner_urn, lc.connection_kind, lc.status AS connection_status, lc.scopes_json,
            lc.access_token_ciphertext, lc.access_token_iv, lc.access_key_version
     FROM content_posts p
     JOIN content_post_destinations d ON d.post_id = p.id AND d.workspace_id = p.workspace_id
     JOIN (
       SELECT id, workspace_id, external_account_id, ('urn:li:person:' || external_account_id) AS owner_urn,
              'person' AS connection_kind, status, scopes_json, access_token_ciphertext, access_token_iv, access_key_version
       FROM linkedin_connections
       UNION ALL
       SELECT id, workspace_id, external_account_id, organization_urn AS owner_urn,
              'organization' AS connection_kind, status, scopes_json, access_token_ciphertext, access_token_iv, access_key_version
       FROM linkedin_organization_connections
     ) lc ON lc.id = d.connection_id AND lc.workspace_id = d.workspace_id`,
    'organization publishing join',
  );
  linkedinPublishing = requiredReplace(
    linkedinPublishing,
    `  if (!scopes.includes('w_member_social')) {
    throw new LinkedInPublishingError('Reconnectez LinkedIn afin d’autoriser la publication (w_member_social).', false);
  }`,
    `  const requiredScope = row.connection_kind === 'organization' ? 'w_organization_social' : 'w_member_social';
  if (!scopes.includes(requiredScope)) {
    throw new LinkedInPublishingError('Reconnectez LinkedIn afin d’autoriser la publication (' + requiredScope + ').', false);
  }`,
    'organization publishing permission',
  );
  linkedinPublishing = requiredReplace(
    linkedinPublishing,
    `    const owner = personUrn(row.person_id);`,
    `    const owner = row.owner_urn || personUrn(row.person_id);`,
    'organization owner URN',
  );
  linkedinPublishing += '\n// SC_LINKEDIN_ORG_PUBLISHING_V1\n';
  fs.writeFileSync(linkedinPublishingPath, linkedinPublishing);
}

// 6) Disconnect supports both personal LinkedIn profiles and LinkedIn Pages.
const cockpitPath = 'src/worker/cockpit-production.ts';
let cockpit = fs.readFileSync(cockpitPath, 'utf8');
if (!cockpit.includes('SC_LINKEDIN_ORG_DISCONNECT_V1')) {
  const linkedInDisconnect = `  } else if (platform === 'linkedin') {
    found = await env.DB.prepare(
      'SELECT id, display_name FROM linkedin_connections WHERE id = ? AND workspace_id = ? LIMIT 1',
    ).bind(connectionId, auth.principal.workspaceId).first<{ id: string; display_name: string }>();
    if (found) {
      await env.DB.prepare(
        "UPDATE linkedin_connections SET status = 'revoked', capabilities_json = '{}', scopes_json = '[]', access_token_ciphertext = '', access_token_iv = '', access_key_version = '', refresh_token_ciphertext = NULL, refresh_token_iv = NULL, refresh_key_version = NULL, access_expires_at = NULL, refresh_expires_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?",
      ).bind(now, connectionId, auth.principal.workspaceId).run();
    }
  } else {`;
  cockpit = requiredReplace(cockpit, linkedInDisconnect, `  } else if (platform === 'linkedin') {
    found = await env.DB.prepare(
      'SELECT id, display_name FROM linkedin_connections WHERE id = ? AND workspace_id = ? LIMIT 1',
    ).bind(connectionId, auth.principal.workspaceId).first<{ id: string; display_name: string }>();
    if (found) {
      await env.DB.prepare(
        "UPDATE linkedin_connections SET status = 'revoked', capabilities_json = '{}', scopes_json = '[]', access_token_ciphertext = '', access_token_iv = '', access_key_version = '', refresh_token_ciphertext = NULL, refresh_token_iv = NULL, refresh_key_version = NULL, access_expires_at = NULL, refresh_expires_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?",
      ).bind(now, connectionId, auth.principal.workspaceId).run();
    } else {
      found = await env.DB.prepare(
        'SELECT id, display_name FROM linkedin_organization_connections WHERE id = ? AND workspace_id = ? LIMIT 1',
      ).bind(connectionId, auth.principal.workspaceId).first<{ id: string; display_name: string }>();
      if (found) {
        await env.DB.prepare(
          "UPDATE linkedin_organization_connections SET status = 'revoked', capabilities_json = '{}', scopes_json = '[]', access_token_ciphertext = '', access_token_iv = '', access_key_version = '', refresh_token_ciphertext = NULL, refresh_token_iv = NULL, refresh_key_version = NULL, access_expires_at = NULL, refresh_expires_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?",
        ).bind(now, connectionId, auth.principal.workspaceId).run();
      }
    }
  } else {`, 'LinkedIn Page disconnect');
  cockpit += '\n// SC_LINKEDIN_ORG_DISCONNECT_V1\n';
  fs.writeFileSync(cockpitPath, cockpit);
}

// 7) UI: distinct Page connector and direct replies to LinkedIn comments.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_LINKEDIN_COMMUNITY_UI_V1')) {
  const replyAnchor = `  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !selectedConversation || !reply.trim() || replyBusy) return;`;
  app = requiredReplace(app, replyAnchor, `  async function connectLinkedInCommunity() {
    if (!workspaceId) return;
    if (!runtime.linkedinOAuthReady) {
      setToast('La connexion LinkedIn doit encore être configurée côté serveur.');
      return;
    }
    try {
      const result = await apiRequest<{ url: string }>('/api/oauth/linkedin/community/start', { method: 'POST' }, workspaceId);
      window.location.assign(result.url);
    } catch (error) {
      setToast(readableError(error));
    }
  }

${replyAnchor}
    if (selectedConversation.platform === 'linkedin' && selectedConversation.latestMessage?.type === 'comment') {
      setReplyBusy(true);
      try {
        await apiRequest('/api/linkedin/comments/reply', {
          method: 'POST',
          body: JSON.stringify({ conversationId: selectedConversation.id, message: reply.trim() }),
        }, workspaceId);
        setReply('');
        setToast('Réponse LinkedIn envoyée.');
        setRefreshIndex((value) => value + 1);
      } catch (error) {
        setToast(readableError(error));
      } finally {
        setReplyBusy(false);
      }
      return;
    }`, 'LinkedIn comment reply UI');

  app = app.replace(
    `if (oauth !== 'linkedin-connected' && oauth !== 'linkedin-error') return;`,
    `if (!['linkedin-connected', 'linkedin-error', 'linkedin-community-connected', 'linkedin-community-error', 'linkedin-community-access-required'].includes(oauth ?? '')) return;`,
  );
  app = app.replace(
    `setToast(oauth === 'linkedin-connected'
      ? 'LinkedIn est connecté.'
      : 'La connexion LinkedIn n’a pas abouti. Vous pouvez réessayer.');`,
    `setToast(oauth === 'linkedin-connected'
      ? 'LinkedIn est connecté.'
      : oauth === 'linkedin-community-connected'
        ? 'La Page LinkedIn est connectée.'
        : oauth === 'linkedin-community-access-required'
          ? 'LinkedIn Community Management doit être activé pour connecter une Page.'
          : 'La connexion LinkedIn n’a pas abouti. Vous pouvez réessayer.');`,
  );

  app = app.replaceAll(
    `              onConnectLinkedIn={(id) => void connectLinkedIn(id)}
              onDisconnect=`,
    `              onConnectLinkedIn={(id) => void connectLinkedIn(id)}
              onConnectLinkedInCommunity={() => void connectLinkedInCommunity()}
              onDisconnect=`,
  );
  app = app.replace(
    `function SettingsPage({ session, connections, runtime, onConnect, onConnectMeta, onConnectLinkedIn, onDisconnect, onRefresh }: {`,
    `function SettingsPage({ session, connections, runtime, onConnect, onConnectMeta, onConnectLinkedIn, onConnectLinkedInCommunity, onDisconnect, onRefresh }: {`,
  );
  app = app.replace(
    `  onConnectLinkedIn: (id?: string) => void;
  onDisconnect:`,
    `  onConnectLinkedIn: (id?: string) => void;
  onConnectLinkedInCommunity: () => void;
  onDisconnect:`,
  );

  const linkedInPersonalButton = `<button className="sc20-linkedin-provider" disabled={!runtime.linkedinOAuthReady} onClick={() => onConnectLinkedIn()}><PlatformMark platform="linkedin" /><span><strong>Connecter LinkedIn</strong><small>{runtime.linkedinOAuthReady ? 'Profil personnel · connexion sécurisée' : 'Configuration LinkedIn requise'}</small></span><ChevronRight size={16} /></button>`;
  app = requiredReplace(app, linkedInPersonalButton, `${linkedInPersonalButton}
            <button className="sc20-linkedin-provider" disabled={!runtime.linkedinOAuthReady} onClick={onConnectLinkedInCommunity}><PlatformMark platform="linkedin" /><span><strong>Connecter une Page LinkedIn</strong><small>{runtime.linkedinOAuthReady ? 'Publications · commentaires · réactions · statistiques' : 'Configuration LinkedIn requise'}</small></span><ChevronRight size={16} /></button>`, 'Settings Page connector');

  app += '\n/* SC_LINKEDIN_COMMUNITY_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('LinkedIn Community Management: Pages, Planner, comments, replies and publishing wired.');
