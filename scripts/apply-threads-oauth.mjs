import fs from 'node:fs';

function requireReplace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Threads OAuth patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Threads keeps its own connection table, but token encryption still uses the common provider context.
const tokenPath = 'src/worker/token-vault.ts';
let token = fs.readFileSync(tokenPath, 'utf8');
if (!token.includes("'threads'")) {
  const match = token.match(/export type OAuthProvider = [^;]+;/);
  if (!match) throw new Error('Threads OAuth patch failed: token provider union anchor not found.');
  token = token.replace(match[0], match[0].replace(';', " | 'threads';"));
  fs.writeFileSync(tokenPath, token);
}

const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('SC_THREADS_OAUTH_ROUTES_V1')) {
  const importAnchor = "import { persistSocialEvent } from './persistence';";
  production = requireReplace(
    production,
    importAnchor,
    `${importAnchor}\nimport {\n  completeThreadsOAuth,\n  refreshExpiringThreadsTokens,\n  startThreadsOAuth,\n  threadsOAuthConfigured,\n  ThreadsOAuthError,\n} from './threads-oauth';`,
    'production import',
  );

  const dispatchAnchor = 'async function dispatchPending(env: Env): Promise<number> {';
  production = requireReplace(
    production,
    dispatchAnchor,
`function threadsOauthErrorResponse(error: ThreadsOAuthError): Response {
  if (error.code === 'OAUTH_NOT_CONFIGURED') return Response.json({ error: error.message, code: error.code }, { status: 503 });
  if (error.code === 'CONNECTION_NOT_FOUND') return Response.json({ error: error.message, code: error.code }, { status: 404 });
  if (error.code === 'INVALID_OAUTH_STATE' || error.code === 'OAUTH_STATE_EXPIRED') {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  return Response.json({ error: error.message, code: error.code }, { status: 502 });
}

async function handleThreadsOAuthStart(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateMutation(request, env, '/api/oauth/threads/start');
  if (!auth.ok) return auth.response;
  if (auth.principal.role !== 'admin' && auth.principal.role !== 'manager') {
    return Response.json({ error: 'Only workspace administrators or managers can connect social accounts.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
  }
  if (env.DEMO_MODE === 'true') {
    return Response.json({ error: 'Threads OAuth is disabled in demo mode.', code: 'LIVE_NOT_READY' }, { status: 503 });
  }
  const body = await request.json().catch(() => undefined) as { connectionId?: unknown } | undefined;
  const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : undefined;
  try {
    return Response.json(await startThreadsOAuth(env.DB, env, auth.principal, connectionId), { status: 201 });
  } catch (error) {
    if (error instanceof ThreadsOAuthError) return threadsOauthErrorResponse(error);
    throw error;
  }
}

function threadsOauthRedirect(env: Env, outcome: 'connected' | 'error'): string {
  const configured = Reflect.get(env, 'THREADS_REDIRECT_URI');
  try {
    const base = new URL(typeof configured === 'string' ? configured : 'https://social.neptunebusiness.com/');
    base.pathname = '/';
    base.search = '?oauth=threads-' + outcome;
    base.hash = '';
    return base.toString();
  } catch {
    return 'https://social.neptunebusiness.com/?oauth=threads-' + outcome;
  }
}

async function handleThreadsOAuthCallback(url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (url.searchParams.has('error') || !state || !code) {
    return Response.redirect(threadsOauthRedirect(env, 'error'), 302);
  }
  try {
    await completeThreadsOAuth(env.DB, env, { state, code });
    return new Response(null, {
      status: 302,
      headers: {
        location: threadsOauthRedirect(env, 'connected'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'threads_oauth_callback_failed',
      code: error instanceof ThreadsOAuthError ? error.code : 'unknown',
    }));
    return new Response(null, {
      status: 302,
      headers: {
        location: threadsOauthRedirect(env, 'error'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  }
}

${dispatchAnchor}`,
    'production handlers',
  );

  const startAnchor = "    const socialStart = url.pathname.match(/^\\/api\\/oauth\\/(youtube|tiktok)\\/start$/);";
  production = requireReplace(
    production,
    startAnchor,
`    if (url.pathname === '/api/oauth/threads/start' && request.method === 'POST') {
      return handleThreadsOAuthStart(request, env);
    }
${startAnchor}`,
    'start route',
  );

  const callbackAnchor = "    const socialCallback = url.pathname.match(/^\\/oauth\\/(youtube|tiktok)\\/callback$/);";
  production = requireReplace(
    production,
    callbackAnchor,
`    if (url.pathname === '/oauth/threads/callback' && request.method === 'GET') {
      return handleThreadsOAuthCallback(url, env);
    }
${callbackAnchor}`,
    'callback route',
  );

  const readinessAnchor = "          linkedinOAuthReady: env.DEMO_MODE !== 'true' && linkedinOAuthConfigured(env),";
  production = requireReplace(
    production,
    readinessAnchor,
    `${readinessAnchor}\n          threadsOAuthReady: env.DEMO_MODE !== 'true' && threadsOAuthConfigured(env),`,
    'runtime readiness',
  );

  const scheduledAnchor = `    try {\n      await dispatchPending(env);`;
  production = requireReplace(
    production,
    scheduledAnchor,
`    try {
      const refresh = await refreshExpiringThreadsTokens(env.DB, env);
      if (refresh.refreshed > 0 || refresh.failed > 0) {
        console.log(JSON.stringify({ event: 'threads_oauth_refresh_sweep', ...refresh }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: 'threads_oauth_refresh_sweep_failed',
        message: error instanceof Error ? error.message : 'unknown',
      }));
    }

    try {
      await dispatchPending(env);`,
    'scheduled refresh',
  );

  production += '\n// SC_THREADS_OAUTH_ROUTES_V1\n';
  fs.writeFileSync(productionPath, production);
}

// Add Threads to the shared account bootstrap without altering the historical social_connections CHECK constraint.
const workerPath = 'src/worker/index.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('SC_THREADS_BOOTSTRAP_V1')) {
  worker = worker.replace(
    "  platform: 'instagram' | 'youtube' | 'tiktok' | 'linkedin';\n  display_name: string;",
    "  platform: 'instagram' | 'youtube' | 'tiktok' | 'linkedin' | 'threads';\n  display_name: string;",
  );

  const linkedInQuery = `    db.prepare(\n      \`SELECT id, platform, display_name, handle, status, last_synced_at\n       FROM social_connections\n       WHERE workspace_id = ?\n       UNION ALL\n       SELECT id, 'linkedin' AS platform, display_name, handle, status, last_synced_at\n       FROM linkedin_connections\n       WHERE workspace_id = ?\n       ORDER BY platform, display_name\`,\n    ).bind(principal.workspaceId, principal.workspaceId),`;
  const threadsQuery = `    db.prepare(\n      \`SELECT id, platform, display_name, handle, status, last_synced_at\n       FROM social_connections\n       WHERE workspace_id = ?\n       UNION ALL\n       SELECT id, 'linkedin' AS platform, display_name, handle, status, last_synced_at\n       FROM linkedin_connections\n       WHERE workspace_id = ?\n       UNION ALL\n       SELECT id, 'threads' AS platform, display_name, handle, status, last_synced_at\n       FROM threads_connections\n       WHERE workspace_id = ?\n       ORDER BY platform, display_name\`,\n    ).bind(principal.workspaceId, principal.workspaceId, principal.workspaceId),`;
  worker = requireReplace(worker, linkedInQuery, threadsQuery, 'bootstrap connection query');
  worker += '\n// SC_THREADS_BOOTSTRAP_V1\n';
  fs.writeFileSync(workerPath, worker);
}

const livePath = 'src/LiveAppV3.tsx';
let live = fs.readFileSync(livePath, 'utf8');
if (!live.includes('SC_THREADS_UI_V1')) {
  if (!live.includes('threadsOAuthReady?: boolean;')) {
    live = requireReplace(
      live,
      '  linkedinOAuthReady?: boolean;',
      '  linkedinOAuthReady?: boolean;\n  threadsOAuthReady?: boolean;',
      'live runtime readiness',
    );
  }

  live = live.replace(
    "type ConnectionPlatform = SocialPlatform | 'facebook' | 'linkedin';",
    "type ConnectionPlatform = SocialPlatform | 'facebook' | 'linkedin' | 'threads';",
  );
  live = live.replace(
    "type ConnectedPlatform = SocialPlatform | 'facebook' | 'linkedin';",
    "type ConnectedPlatform = SocialPlatform | 'facebook' | 'linkedin' | 'threads';",
  );

  if (!live.includes("if (platform === 'threads') return 'Threads';")) {
    live = requireReplace(
      live,
      "  if (platform === 'linkedin') return 'LinkedIn';",
      "  if (platform === 'linkedin') return 'LinkedIn';\n  if (platform === 'threads') return 'Threads';",
      'Threads label',
    );
  }

  if (!live.includes('sc24-threads-glyph')) {
    live = requireReplace(
      live,
      "  const icon = platform === 'linkedin'",
      "  const icon = platform === 'threads'\n    ? <strong className=\"sc24-threads-glyph\" style={{ fontSize: Math.max(11, size - 1), lineHeight: 1 }}>@</strong>\n    : platform === 'linkedin'",
      'Threads platform mark',
    );
  }

  const toastEffect = `  useEffect(() => {\n    if (!toast) return undefined;\n    const timer = window.setTimeout(() => setToast(''), 3600);\n    return () => window.clearTimeout(timer);\n  }, [toast]);`;
  live = requireReplace(
    live,
    toastEffect,
`${toastEffect}

  useEffect(() => {
    const current = new URL(window.location.href);
    const oauth = current.searchParams.get('oauth');
    if (oauth !== 'threads-connected' && oauth !== 'threads-error') return;
    setToast(oauth === 'threads-connected'
      ? 'Threads est connecté.'
      : 'La connexion Threads n’a pas abouti. Vous pouvez réessayer.');
    current.searchParams.delete('oauth');
    const next = current.pathname + (current.searchParams.toString() ? '?' + current.searchParams.toString() : '') + current.hash;
    window.history.replaceState({}, '', next);
  }, []);`,
    'OAuth feedback',
  );

  const sendReplyAnchor = '  async function sendReply(event: FormEvent) {';
  live = requireReplace(
    live,
    sendReplyAnchor,
`  async function connectThreads(connectionId?: string) {
    if (!workspaceId) return;
    if (!runtime.threadsOAuthReady) {
      setToast('La connexion Threads doit encore être configurée côté serveur.');
      return;
    }
    try {
      const result = await apiRequest<{ url: string }>('/api/oauth/threads/start', {
        method: 'POST',
        body: JSON.stringify(connectionId ? { connectionId } : {}),
      }, workspaceId);
      window.location.assign(result.url);
    } catch (error) {
      setToast(readableError(error));
    }
  }

${sendReplyAnchor}`,
    'connect function',
  );

  live = live.replaceAll(
    "              onConnectLinkedIn={(id) => void connectLinkedIn(id)}\n              onRefresh=",
    "              onConnectLinkedIn={(id) => void connectLinkedIn(id)}\n              onConnectThreads={(id) => void connectThreads(id)}\n              onRefresh=",
  );
  live = live.replace(
    'function SettingsPage({ session, connections, runtime, onConnect, onConnectMeta, onConnectLinkedIn, onRefresh }: {',
    'function SettingsPage({ session, connections, runtime, onConnect, onConnectMeta, onConnectLinkedIn, onConnectThreads, onRefresh }: {',
  );
  live = live.replace(
    "  onConnectLinkedIn: (id?: string) => void;\n  onRefresh: () => void;",
    "  onConnectLinkedIn: (id?: string) => void;\n  onConnectThreads: (id?: string) => void;\n  onRefresh: () => void;",
  );

  const settingsButton = '<button className="sc20-linkedin-provider" disabled={!runtime.linkedinOAuthReady} onClick={() => onConnectLinkedIn()}><PlatformMark platform="linkedin" /><span><strong>Connecter LinkedIn</strong><small>{runtime.linkedinOAuthReady ? \'Profil personnel · connexion sécurisée\' : \'Configuration LinkedIn requise\'}</small></span><ChevronRight size={16} /></button>';
  live = requireReplace(
    live,
    settingsButton,
    `${settingsButton}\n            <button className="sc24-threads-provider" disabled={!runtime.threadsOAuthReady} onClick={() => onConnectThreads()}><PlatformMark platform="threads" /><span><strong>Connecter Threads</strong><small>{runtime.threadsOAuthReady ? 'Profil Threads · connexion sécurisée' : 'Configuration Threads requise'}</small></span><ChevronRight size={16} /></button>`,
    'settings provider button',
  );

  live = live.replace(
    '          linkedinReady={Boolean(runtime.linkedinOAuthReady)}\n          onConnectLinkedIn={(id) => void connectLinkedIn(id)}\n          onClose=',
    '          linkedinReady={Boolean(runtime.linkedinOAuthReady)}\n          onConnectLinkedIn={(id) => void connectLinkedIn(id)}\n          threadsReady={Boolean(runtime.threadsOAuthReady)}\n          onConnectThreads={(id) => void connectThreads(id)}\n          onClose=',
  );
  live = live.replace(
    'function AccountPanel({ connections, ready, metaReady, linkedinReady, onConnectLinkedIn, onClose, onConnect, onConnectMeta, onSwitch }: {',
    'function AccountPanel({ connections, ready, metaReady, linkedinReady, onConnectLinkedIn, threadsReady, onConnectThreads, onClose, onConnect, onConnectMeta, onSwitch }: {',
  );
  live = live.replace(
    "  linkedinReady: boolean;\n  onConnectLinkedIn: (id?: string) => void;\n  onClose: () => void;",
    "  linkedinReady: boolean;\n  onConnectLinkedIn: (id?: string) => void;\n  threadsReady: boolean;\n  onConnectThreads: (id?: string) => void;\n  onClose: () => void;",
  );

  const panelButton = '<button className="sc20-linkedin-provider" disabled={!linkedinReady} onClick={() => onConnectLinkedIn()}><PlatformMark platform="linkedin" size={19} /><span><strong>LinkedIn</strong><small>{linkedinReady ? \'Connecter votre profil personnel\' : \'Configuration LinkedIn requise\'}</small></span>{linkedinReady ? <ChevronRight size={17} /> : <span className="sc10-wait">À configurer</span>}</button>';
  live = requireReplace(
    live,
    panelButton,
    `${panelButton}\n            <button className="sc24-threads-provider" disabled={!threadsReady} onClick={() => onConnectThreads()}><PlatformMark platform="threads" size={19} /><span><strong>Threads</strong><small>{threadsReady ? 'Connecter votre profil Threads' : 'Configuration Threads requise'}</small></span>{threadsReady ? <ChevronRight size={17} /> : <span className="sc10-wait">À configurer</span>}</button>`,
    'account panel provider button',
  );

  live = live.replaceAll(
    "connection.platform === 'linkedin' ? !runtime.linkedinOAuthReady : connection.platform === 'facebook' ? !runtime.metaOAuthReady : !ready[connection.platform]",
    "connection.platform === 'threads' ? !runtime.threadsOAuthReady : connection.platform === 'linkedin' ? !runtime.linkedinOAuthReady : connection.platform === 'facebook' ? !runtime.metaOAuthReady : !ready[connection.platform as SocialPlatform]",
  );
  live = live.replaceAll(
    "connection.platform === 'linkedin' ? onConnectLinkedIn(connection.id) : connection.platform === 'facebook' || (connection.platform === 'instagram' && runtime.metaOAuthReady) ? onConnectMeta(connection.platform as 'facebook' | 'instagram') : onConnect(connection.platform as SocialPlatform, connection.id)",
    "connection.platform === 'threads' ? onConnectThreads(connection.id) : connection.platform === 'linkedin' ? onConnectLinkedIn(connection.id) : connection.platform === 'facebook' || (connection.platform === 'instagram' && runtime.metaOAuthReady) ? onConnectMeta(connection.platform as 'facebook' | 'instagram') : onConnect(connection.platform as SocialPlatform, connection.id)",
  );
  live = live.replaceAll(
    "connection.platform === 'linkedin' ? linkedinReady && onConnectLinkedIn(connection.id) : connection.platform === 'facebook' ? metaReady && onConnectMeta('facebook') : ready[connection.platform as SocialPlatform] && onConnect(connection.platform as SocialPlatform, connection.id)",
    "connection.platform === 'threads' ? threadsReady && onConnectThreads(connection.id) : connection.platform === 'linkedin' ? linkedinReady && onConnectLinkedIn(connection.id) : connection.platform === 'facebook' ? metaReady && onConnectMeta('facebook') : ready[connection.platform as SocialPlatform] && onConnect(connection.platform as SocialPlatform, connection.id)",
  );
  live = live.replaceAll(
    "connection.platform === 'linkedin' ? (linkedinReady ? 'Reconnecter' : 'À configurer') : connection.platform === 'facebook' ? (metaReady ? 'Reconnecter' : 'À configurer') : ready[connection.platform as SocialPlatform] ? 'Reconnecter' : 'À configurer'",
    "connection.platform === 'threads' ? (threadsReady ? 'Reconnecter' : 'À configurer') : connection.platform === 'linkedin' ? (linkedinReady ? 'Reconnecter' : 'À configurer') : connection.platform === 'facebook' ? (metaReady ? 'Reconnecter' : 'À configurer') : ready[connection.platform as SocialPlatform] ? 'Reconnecter' : 'À configurer'",
  );

  // The OAuth connection is production-ready, but publishing is enabled only when the dedicated
  // Threads delivery adapter is implemented. This prevents silently routing Threads through another provider.
  live = live.replace(
    'const publishableKnown = known;',
    "const publishableKnown = known.filter((connection) => connection.platform !== 'threads');",
  );

  live += '\n/* SC_THREADS_UI_V1 */\n';
  fs.writeFileSync(livePath, live);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes('threadsOAuthReady?: boolean;')) {
  main = requireReplace(
    main,
    '  linkedinOAuthReady?: boolean;',
    '  linkedinOAuthReady?: boolean;\n  threadsOAuthReady?: boolean;',
    'main runtime type',
  );
  fs.writeFileSync(mainPath, main);
}

console.log('Threads OAuth connection and automatic token refresh are wired into Social Conversion.');
