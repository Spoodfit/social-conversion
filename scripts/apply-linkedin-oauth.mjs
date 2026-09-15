import fs from 'node:fs';

function requireReplace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`LinkedIn OAuth patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// LinkedIn is connection-only in this first pass. Keep it outside the publishing SocialPlatform union
// so a connected LinkedIn profile cannot accidentally be sent through another provider dispatcher.
const tokenPath = 'src/worker/token-vault.ts';
let token = fs.readFileSync(tokenPath, 'utf8');
if (!token.includes("'linkedin'")) {
  const candidates = [
    "export type OAuthProvider = 'instagram' | 'facebook' | 'youtube' | 'tiktok';",
    "export type OAuthProvider = 'instagram' | 'youtube' | 'tiktok';",
  ];
  const current = candidates.find((candidate) => token.includes(candidate));
  if (!current) throw new Error('LinkedIn OAuth patch failed: token provider union anchor not found.');
  token = token.replace(current, current.replace("'tiktok';", "'tiktok' | 'linkedin';"));
  fs.writeFileSync(tokenPath, token);
}

const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('SC_LINKEDIN_OAUTH_ROUTES_V1')) {
  const importAnchor = "import { persistSocialEvent } from './persistence';";
  production = requireReplace(
    production,
    importAnchor,
    `${importAnchor}\nimport {\n  completeLinkedInOAuth,\n  linkedinOAuthConfigured,\n  LinkedInOAuthError,\n  startLinkedInOAuth,\n} from './linkedin-oauth';`,
    'production import',
  );

  const dispatchAnchor = 'async function dispatchPending(env: Env): Promise<number> {';
  production = requireReplace(
    production,
    dispatchAnchor,
`function linkedinOauthErrorResponse(error: LinkedInOAuthError): Response {
  if (error.code === 'OAUTH_NOT_CONFIGURED') return Response.json({ error: error.message, code: error.code }, { status: 503 });
  if (error.code === 'CONNECTION_NOT_FOUND') return Response.json({ error: error.message, code: error.code }, { status: 404 });
  if (error.code === 'INVALID_OAUTH_STATE' || error.code === 'OAUTH_STATE_EXPIRED') {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  return Response.json({ error: error.message, code: error.code }, { status: 502 });
}

async function handleLinkedInOAuthStart(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateMutation(request, env, '/api/oauth/linkedin/start');
  if (!auth.ok) return auth.response;
  if (auth.principal.role !== 'admin' && auth.principal.role !== 'manager') {
    return Response.json({ error: 'Only workspace administrators or managers can connect social accounts.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
  }
  if (env.DEMO_MODE === 'true') {
    return Response.json({ error: 'LinkedIn OAuth is disabled in demo mode.', code: 'LIVE_NOT_READY' }, { status: 503 });
  }
  const body = await request.json().catch(() => undefined) as { connectionId?: unknown } | undefined;
  const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : undefined;
  try {
    return Response.json(await startLinkedInOAuth(env.DB, env, auth.principal, connectionId), { status: 201 });
  } catch (error) {
    if (error instanceof LinkedInOAuthError) return linkedinOauthErrorResponse(error);
    throw error;
  }
}

function linkedinOauthRedirect(env: Env, outcome: 'connected' | 'error'): string {
  const configured = Reflect.get(env, 'LINKEDIN_REDIRECT_URI');
  try {
    const base = new URL(typeof configured === 'string' ? configured : 'https://social.neptunebusiness.com/');
    base.pathname = '/';
    base.search = '?oauth=linkedin-' + outcome;
    base.hash = '';
    return base.toString();
  } catch {
    return 'https://social.neptunebusiness.com/?oauth=linkedin-' + outcome;
  }
}

async function handleLinkedInOAuthCallback(url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (url.searchParams.has('error') || !state || !code) {
    return Response.redirect(linkedinOauthRedirect(env, 'error'), 302);
  }
  try {
    await completeLinkedInOAuth(env.DB, env, { state, code });
    return new Response(null, {
      status: 302,
      headers: {
        location: linkedinOauthRedirect(env, 'connected'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'linkedin_oauth_callback_failed',
      code: error instanceof LinkedInOAuthError ? error.code : 'unknown',
    }));
    return new Response(null, {
      status: 302,
      headers: {
        location: linkedinOauthRedirect(env, 'error'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  }
}

${dispatchAnchor}`,
    'production handlers',
  );

  const socialStart = "    const socialStart = url.pathname.match(/^\\/api\\/oauth\\/(youtube|tiktok)\\/start$/);";
  production = requireReplace(
    production,
    socialStart,
`    if (url.pathname === '/api/oauth/linkedin/start' && request.method === 'POST') {
      return handleLinkedInOAuthStart(request, env);
    }
${socialStart}`,
    'start route',
  );

  const socialCallback = "    const socialCallback = url.pathname.match(/^\\/oauth\\/(youtube|tiktok)\\/callback$/);";
  production = requireReplace(
    production,
    socialCallback,
`    if (url.pathname === '/oauth/linkedin/callback' && request.method === 'GET') {
      return handleLinkedInOAuthCallback(url, env);
    }
${socialCallback}`,
    'callback route',
  );

  if (production.includes("          metaOAuthReady: env.DEMO_MODE !== 'true' && metaOAuthConfigured(env),")) {
    production = production.replace(
      "          metaOAuthReady: env.DEMO_MODE !== 'true' && metaOAuthConfigured(env),",
      "          metaOAuthReady: env.DEMO_MODE !== 'true' && metaOAuthConfigured(env),\n          linkedinOAuthReady: env.DEMO_MODE !== 'true' && linkedinOAuthConfigured(env),",
    );
  } else {
    production = requireReplace(
      production,
      "          tiktokOAuthReady: env.DEMO_MODE !== 'true' && socialOAuthConfigured(env, 'tiktok'),",
      "          tiktokOAuthReady: env.DEMO_MODE !== 'true' && socialOAuthConfigured(env, 'tiktok'),\n          linkedinOAuthReady: env.DEMO_MODE !== 'true' && linkedinOAuthConfigured(env),",
      'runtime readiness',
    );
  }

  production += '\n// SC_LINKEDIN_OAUTH_ROUTES_V1\n';
  fs.writeFileSync(productionPath, production);
}

// Expose LinkedIn profiles in the common account switcher without pretending that LinkedIn DMs
// or organization feeds are available.
const workerPath = 'src/worker/index.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('SC_LINKEDIN_BOOTSTRAP_V1')) {
  worker = worker.replace(
    "  platform: 'instagram' | 'youtube' | 'tiktok';\n  display_name: string;",
    "  platform: 'instagram' | 'youtube' | 'tiktok' | 'linkedin';\n  display_name: string;",
  );

  const connectionQuery = `    db.prepare(\n      \`SELECT id, platform, display_name, handle, status, last_synced_at\n       FROM social_connections\n       WHERE workspace_id = ?\n       ORDER BY platform, display_name\`,\n    ).bind(principal.workspaceId),`;
  const linkedInQuery = `    db.prepare(\n      \`SELECT id, platform, display_name, handle, status, last_synced_at\n       FROM social_connections\n       WHERE workspace_id = ?\n       UNION ALL\n       SELECT id, 'linkedin' AS platform, display_name, handle, status, last_synced_at\n       FROM linkedin_connections\n       WHERE workspace_id = ?\n       ORDER BY platform, display_name\`,\n    ).bind(principal.workspaceId, principal.workspaceId),`;
  worker = requireReplace(worker, connectionQuery, linkedInQuery, 'bootstrap connection query');
  worker += '\n// SC_LINKEDIN_BOOTSTRAP_V1\n';
  fs.writeFileSync(workerPath, worker);
}

const livePath = 'src/LiveAppV3.tsx';
let live = fs.readFileSync(livePath, 'utf8');
if (!live.includes('SC_LINKEDIN_UI_V1')) {
  if (!live.includes('linkedinOAuthReady?: boolean;')) {
    const readinessAnchor = live.includes('  metaOAuthReady?: boolean;')
      ? '  metaOAuthReady?: boolean;'
      : '  tiktokOAuthReady?: boolean;';
    live = requireReplace(live, readinessAnchor, `${readinessAnchor}\n  linkedinOAuthReady?: boolean;`, 'live runtime readiness');
  }

  live = live.replace(
    "type ConnectionPlatform = SocialPlatform | 'facebook';",
    "type ConnectionPlatform = SocialPlatform | 'facebook' | 'linkedin';",
  );
  live = live.replace(
    "type ConnectedPlatform = SocialPlatform | 'facebook';",
    "type ConnectedPlatform = SocialPlatform | 'facebook' | 'linkedin';",
  );

  const labelAnchor = "  if (platform === 'facebook') return 'Facebook';";
  if (!live.includes("if (platform === 'linkedin') return 'LinkedIn';")) {
    live = requireReplace(live, labelAnchor, `${labelAnchor}\n  if (platform === 'linkedin') return 'LinkedIn';`, 'LinkedIn label');
  }

  const iconAnchor = "  const icon = platform === 'facebook'";
  if (!live.includes('sc20-linkedin-glyph')) {
    live = requireReplace(
      live,
      iconAnchor,
      "  const icon = platform === 'linkedin'\n    ? <strong className=\"sc20-linkedin-glyph\" style={{ fontSize: Math.max(9, size - 3), lineHeight: 1 }}>in</strong>\n    : platform === 'facebook'",
      'LinkedIn platform mark',
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
    if (oauth !== 'linkedin-connected' && oauth !== 'linkedin-error') return;
    setToast(oauth === 'linkedin-connected'
      ? 'LinkedIn est connecté.'
      : 'La connexion LinkedIn n’a pas abouti. Vous pouvez réessayer.');
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
`  async function connectLinkedIn(connectionId?: string) {
    if (!workspaceId) return;
    if (!runtime.linkedinOAuthReady) {
      setToast('La connexion LinkedIn doit encore être configurée côté serveur.');
      return;
    }
    try {
      const result = await apiRequest<{ url: string }>('/api/oauth/linkedin/start', {
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

  // LinkedIn is visible and switchable, but deliberately excluded from the composer until its
  // delivery adapter is implemented and validated.
  live = live.replace(
    "connection.platform !== 'facebook'",
    "connection.platform !== 'facebook' && connection.platform !== 'linkedin'",
  );
  live = live.replace(
    "selected?.platform === 'facebook' ? [] : [id]",
    "selected?.platform === 'facebook' || selected?.platform === 'linkedin' ? [] : [id]",
  );
  live = live.replace(
    "activeConnection?.platform === 'facebook' ? [] : [activeAccountId]",
    "activeConnection?.platform === 'facebook' || activeConnection?.platform === 'linkedin' ? [] : [activeAccountId]",
  );

  live = live.replaceAll(
    "              onConnectMeta={(platform) => void connectMeta(platform)}\n              onRefresh=",
    "              onConnectMeta={(platform) => void connectMeta(platform)}\n              onConnectLinkedIn={(id) => void connectLinkedIn(id)}\n              onRefresh=",
  );

  live = live.replace(
    'function SettingsPage({ session, connections, runtime, onConnect, onConnectMeta, onRefresh }: {',
    'function SettingsPage({ session, connections, runtime, onConnect, onConnectMeta, onConnectLinkedIn, onRefresh }: {',
  );
  live = live.replace(
    "  onConnectMeta: (platform: 'facebook' | 'instagram') => void;\n  onRefresh: () => void;",
    "  onConnectMeta: (platform: 'facebook' | 'instagram') => void;\n  onConnectLinkedIn: (id?: string) => void;\n  onRefresh: () => void;",
  );

  live = live.replace(
    '          <div className="sc10-settings-connect">',
    `          <div className="sc10-settings-connect">
            <button className="sc20-linkedin-provider" disabled={!runtime.linkedinOAuthReady} onClick={() => onConnectLinkedIn()}><PlatformMark platform="linkedin" /><span><strong>Connecter LinkedIn</strong><small>{runtime.linkedinOAuthReady ? 'Profil personnel · connexion sécurisée' : 'Configuration LinkedIn requise'}</small></span><ChevronRight size={16} /></button>`,
  );

  live = live.replace(
    '          metaReady={Boolean(runtime.metaOAuthReady)}\n          onClose=',
    '          metaReady={Boolean(runtime.metaOAuthReady)}\n          linkedinReady={Boolean(runtime.linkedinOAuthReady)}\n          onConnectLinkedIn={(id) => void connectLinkedIn(id)}\n          onClose=',
  );
  live = live.replace(
    'function AccountPanel({ connections, ready, metaReady, onClose, onConnect, onConnectMeta, onSwitch }: {',
    'function AccountPanel({ connections, ready, metaReady, linkedinReady, onConnectLinkedIn, onClose, onConnect, onConnectMeta, onSwitch }: {',
  );
  live = live.replace(
    '  metaReady: boolean;\n  onClose: () => void;',
    '  metaReady: boolean;\n  linkedinReady: boolean;\n  onConnectLinkedIn: (id?: string) => void;\n  onClose: () => void;',
  );
  live = live.replace(
    '          <div className="sc10-provider-list">',
    `          <div className="sc10-provider-list">
            <button className="sc20-linkedin-provider" disabled={!linkedinReady} onClick={() => onConnectLinkedIn()}><PlatformMark platform="linkedin" size={19} /><span><strong>LinkedIn</strong><small>{linkedinReady ? 'Connecter votre profil personnel' : 'Configuration LinkedIn requise'}</small></span>{linkedinReady ? <ChevronRight size={17} /> : <span className="sc10-wait">À configurer</span>}</button>`,
  );

  // Avoid indexing the SocialPlatform readiness map with the connection-only LinkedIn provider.
  live = live.replaceAll(
    "connection.platform === 'facebook' ? !runtime.metaOAuthReady : !ready[connection.platform]",
    "connection.platform === 'linkedin' ? !runtime.linkedinOAuthReady : connection.platform === 'facebook' ? !runtime.metaOAuthReady : !ready[connection.platform]",
  );
  live = live.replaceAll(
    "connection.platform === 'facebook' || (connection.platform === 'instagram' && runtime.metaOAuthReady) ? onConnectMeta(connection.platform as 'facebook' | 'instagram') : onConnect(connection.platform as SocialPlatform, connection.id)",
    "connection.platform === 'linkedin' ? onConnectLinkedIn(connection.id) : connection.platform === 'facebook' || (connection.platform === 'instagram' && runtime.metaOAuthReady) ? onConnectMeta(connection.platform as 'facebook' | 'instagram') : onConnect(connection.platform as SocialPlatform, connection.id)",
  );
  live = live.replaceAll(
    "connection.platform === 'facebook' ? metaReady && onConnectMeta('facebook') : ready[connection.platform as SocialPlatform] && onConnect(connection.platform as SocialPlatform, connection.id)",
    "connection.platform === 'linkedin' ? linkedinReady && onConnectLinkedIn(connection.id) : connection.platform === 'facebook' ? metaReady && onConnectMeta('facebook') : ready[connection.platform as SocialPlatform] && onConnect(connection.platform as SocialPlatform, connection.id)",
  );
  live = live.replaceAll(
    "connection.platform === 'facebook' ? (metaReady ? 'Reconnecter' : 'À configurer') : ready[connection.platform as SocialPlatform] ? 'Reconnecter' : 'À configurer'",
    "connection.platform === 'linkedin' ? (linkedinReady ? 'Reconnecter' : 'À configurer') : connection.platform === 'facebook' ? (metaReady ? 'Reconnecter' : 'À configurer') : ready[connection.platform as SocialPlatform] ? 'Reconnecter' : 'À configurer'",
  );

  live = live.replace(
    'Les mots de passe restent chez Meta, Google ou TikTok.',
    'Les mots de passe restent chez Meta, Google, TikTok ou LinkedIn.',
  );
  live += '\n/* SC_LINKEDIN_UI_V1 */\n';
  fs.writeFileSync(livePath, live);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes('linkedinOAuthReady?: boolean;')) {
  const anchor = main.includes('  metaOAuthReady?: boolean;') ? '  metaOAuthReady?: boolean;' : '  tiktokOAuthReady?: boolean;';
  main = requireReplace(main, anchor, `${anchor}\n  linkedinOAuthReady?: boolean;`, 'main runtime type');
  fs.writeFileSync(mainPath, main);
}

console.log('LinkedIn OAuth connection is wired into Social Conversion.');
