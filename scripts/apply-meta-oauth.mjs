import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Meta OAuth patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Token vault: Facebook Page tokens are encrypted exactly like the other provider tokens.
const tokenPath = 'src/worker/token-vault.ts';
let tokenSource = fs.readFileSync(tokenPath, 'utf8');
if (!tokenSource.includes("'facebook' | 'youtube'")) {
  tokenSource = replaceOnce(
    tokenSource,
    "export type OAuthProvider = 'instagram' | 'youtube' | 'tiktok';",
    "export type OAuthProvider = 'instagram' | 'facebook' | 'youtube' | 'tiktok';",
    'token provider union',
  );
  fs.writeFileSync(tokenPath, tokenSource);
}

// Production Worker routes and runtime readiness.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes("from './meta-oauth'")) {
  const socialImportEnd = "} from './social-account-oauth';";
  production = replaceOnce(
    production,
    socialImportEnd,
    `${socialImportEnd}\nimport {\n  completeMetaOAuth,\n  MetaOAuthError,\n  metaOAuthConfigured,\n  startMetaOAuth,\n} from './meta-oauth';`,
    'Meta OAuth import',
  );

  production = replaceOnce(
    production,
    'async function dispatchPending(env: Env): Promise<number> {',
`function metaOauthErrorResponse(error: MetaOAuthError): Response {
  if (error.code === 'OAUTH_NOT_CONFIGURED') return Response.json({ error: error.message, code: error.code }, { status: 503 });
  if (error.code === 'INVALID_OAUTH_STATE' || error.code === 'OAUTH_STATE_EXPIRED') {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  return Response.json({ error: error.message, code: error.code }, { status: 502 });
}

async function handleMetaOAuthStart(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateMutation(request, env, '/api/oauth/meta/start');
  if (!auth.ok) return auth.response;
  if (auth.principal.role !== 'admin' && auth.principal.role !== 'manager') {
    return Response.json({ error: 'Only workspace administrators or managers can connect social accounts.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
  }
  if (env.DEMO_MODE === 'true') {
    return Response.json({ error: 'Meta OAuth is disabled in demo mode.', code: 'LIVE_NOT_READY' }, { status: 503 });
  }
  try {
    return Response.json(await startMetaOAuth(env.DB, env, auth.principal), { status: 201 });
  } catch (error) {
    if (error instanceof MetaOAuthError) return metaOauthErrorResponse(error);
    throw error;
  }
}

function metaOauthRedirect(env: Env, outcome: 'connected' | 'error', connectedCount = 0): string {
  const configured = Reflect.get(env, 'META_REDIRECT_URI');
  try {
    const base = new URL(typeof configured === 'string' ? configured : 'https://social.neptunebusiness.com/');
    base.pathname = '/';
    base.search = '?oauth=meta-' + outcome + (outcome === 'connected' ? '&connected=' + connectedCount : '');
    base.hash = '';
    return base.toString();
  } catch {
    return 'https://social.neptunebusiness.com/?oauth=meta-' + outcome;
  }
}

async function handleMetaOAuthCallback(url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (url.searchParams.has('error') || !state || !code) {
    return Response.redirect(metaOauthRedirect(env, 'error'), 302);
  }
  try {
    const result = await completeMetaOAuth(env.DB, env, { state, code });
    return new Response(null, {
      status: 302,
      headers: {
        location: metaOauthRedirect(env, 'connected', result.connectedCount),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'meta_oauth_callback_failed',
      code: error instanceof MetaOAuthError ? error.code : 'unknown',
    }));
    return new Response(null, {
      status: 302,
      headers: {
        location: metaOauthRedirect(env, 'error'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  }
}

async function dispatchPending(env: Env): Promise<number> {`,
    'Meta OAuth handlers',
  );

  production = replaceOnce(
    production,
`    if (url.pathname === '/api/oauth/instagram/start' && request.method === 'POST') {
      return handleInstagramOAuthStart(request, env);
    }
    const socialStart = url.pathname.match(/^\\/api\\/oauth\\/(youtube|tiktok)\\/start$/);`,
`    if (url.pathname === '/api/oauth/instagram/start' && request.method === 'POST') {
      return handleInstagramOAuthStart(request, env);
    }
    if (url.pathname === '/api/oauth/meta/start' && request.method === 'POST') {
      return handleMetaOAuthStart(request, env);
    }
    const socialStart = url.pathname.match(/^\\/api\\/oauth\\/(youtube|tiktok)\\/start$/);`,
    'Meta OAuth start route',
  );

  production = replaceOnce(
    production,
`    if (url.pathname === '/oauth/instagram/callback' && request.method === 'GET') {
      return handleInstagramOAuthCallback(url, env);
    }
    const socialCallback = url.pathname.match(/^\\/oauth\\/(youtube|tiktok)\\/callback$/);`,
`    if (url.pathname === '/oauth/instagram/callback' && request.method === 'GET') {
      return handleInstagramOAuthCallback(url, env);
    }
    if (url.pathname === '/oauth/meta/callback' && request.method === 'GET') {
      return handleMetaOAuthCallback(url, env);
    }
    const socialCallback = url.pathname.match(/^\\/oauth\\/(youtube|tiktok)\\/callback$/);`,
    'Meta OAuth callback route',
  );

  production = replaceOnce(
    production,
    "          tiktokOAuthReady: env.DEMO_MODE !== 'true' && socialOAuthConfigured(env, 'tiktok'),",
    "          tiktokOAuthReady: env.DEMO_MODE !== 'true' && socialOAuthConfigured(env, 'tiktok'),\n          metaOAuthReady: env.DEMO_MODE !== 'true' && metaOAuthConfigured(env),",
    'Meta runtime readiness',
  );

  fs.writeFileSync(productionPath, production);
}

// Live UI: Facebook is a connected-account platform, but not yet a planning platform.
const livePath = 'src/LiveAppV3.tsx';
let live = fs.readFileSync(livePath, 'utf8');
if (!live.includes('sc14-meta-provider')) {
  if (!live.includes('metaOAuthReady?: boolean;')) {
    live = replaceOnce(
      live,
      '  tiktokOAuthReady?: boolean;\n',
      '  tiktokOAuthReady?: boolean;\n  metaOAuthReady?: boolean;\n',
      'Live runtime Meta readiness',
    );
  }

  live = replaceOnce(
    live,
    "type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';",
    "type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';\ntype ConnectionPlatform = SocialPlatform | 'facebook';",
    'connection platform type',
  );
  live = replaceOnce(live, '  platform: SocialPlatform;\n  displayName: string;', '  platform: ConnectionPlatform;\n  displayName: string;', 'LiveConnection platform');

  live = replaceOnce(
    live,
`function platformLabel(platform: SocialPlatform) {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  return 'TikTok';
}`,
`function platformLabel(platform: ConnectionPlatform) {
  if (platform === 'facebook') return 'Facebook';
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  return 'TikTok';
}`,
    'platform label',
  );

  live = replaceOnce(
    live,
`function PlatformMark({ platform, size = 16 }: { platform: SocialPlatform; size?: number }) {
  const icon = platform === 'instagram'
    ? <Camera size={size} />
    : platform === 'youtube'
      ? <Video size={size} />
      : <Music2 size={size} />;
  return <span className={\`sc3-platform sc3-\${platform}\`}>{icon}</span>;
}`,
`function PlatformMark({ platform, size = 16 }: { platform: ConnectionPlatform; size?: number }) {
  const icon = platform === 'facebook'
    ? <strong className="sc14-facebook-glyph" style={{ fontSize: Math.max(11, size) }}>f</strong>
    : platform === 'instagram'
      ? <Camera size={size} />
      : platform === 'youtube'
        ? <Video size={size} />
        : <Music2 size={size} />;
  return <span className={\`sc3-platform sc3-\${platform}\`}>{icon}</span>;
}`,
    'Facebook platform mark',
  );

  live = live.replace(
    "const match = oauth?.match(/^(instagram|youtube|tiktok)-(connected|error)$/);",
    "const match = oauth?.match(/^(instagram|youtube|tiktok|meta)-(connected|error)$/);",
  );
  live = live.replace(
`    const platform = match[1] as SocialPlatform;
    const outcome = match[2];
    setToast(outcome === 'connected'
      ? platformLabel(platform) + ' est connecté.'
      : 'La connexion ' + platformLabel(platform) + ' n’a pas abouti. Vous pouvez réessayer.');
    current.searchParams.delete('oauth');`,
`    const provider = match[1] as SocialPlatform | 'meta';
    const outcome = match[2];
    const providerName = provider === 'meta' ? 'Facebook & Instagram' : platformLabel(provider);
    const connectedCount = Number(current.searchParams.get('connected') ?? '0');
    setToast(outcome === 'connected'
      ? provider === 'meta' && connectedCount > 0
        ? providerName + ' : ' + connectedCount + ' compte' + (connectedCount > 1 ? 's' : '') + ' connecté' + (connectedCount > 1 ? 's' : '') + '.'
        : providerName + ' est connecté.'
      : 'La connexion ' + providerName + ' n’a pas abouti. Vous pouvez réessayer.');
    current.searchParams.delete('oauth');
    current.searchParams.delete('connected');`,
  );

  live = replaceOnce(
    live,
    '  async function sendReply(event: FormEvent) {',
`  async function connectMeta() {
    if (!workspaceId) return;
    if (!runtime.metaOAuthReady) {
      setToast('La connexion Meta doit encore être configurée côté serveur.');
      return;
    }
    try {
      const result = await apiRequest<{ url: string }>('/api/oauth/meta/start', { method: 'POST', body: '{}' }, workspaceId);
      window.location.assign(result.url);
    } catch (error) {
      setToast(readableError(error));
    }
  }

  async function sendReply(event: FormEvent) {`,
    'connectMeta function',
  );

  live = replaceOnce(
    live,
    '  const connectedConnections = useMemo(() => connections.filter((connection) => connection.status === \'connected\'), [connections]);',
    "  const connectedConnections = useMemo(() => connections.filter((connection) => connection.status === 'connected'), [connections]);\n  const publishableConnections = useMemo(() => connectedConnections.filter((connection): connection is LiveConnection & { platform: SocialPlatform } => connection.platform !== 'facebook'), [connectedConnections]);",
    'publishable connections',
  );

  live = live.replaceAll('connections={connectedConnections}', 'connections={publishableConnections}');
  live = live.replace(
    '  connections: LiveConnection[];\n  selectedIds: string[];',
    '  connections: Array<LiveConnection & { platform: SocialPlatform }>;\n  selectedIds: string[];',
  );

  live = live.replace(
    "    if (id !== 'all' && page === 'create') setSelectedConnectionIds([id]);",
    "    if (id !== 'all' && page === 'create') {\n      const selected = connectedConnections.find((connection) => connection.id === id);\n      setSelectedConnectionIds(selected?.platform === 'facebook' ? [] : [id]);\n    }",
  );
  live = live.replace(
    "    if (activeAccountId !== 'all') setSelectedConnectionIds([activeAccountId]);\n    navigate('create');",
    "    if (activeAccountId !== 'all') setSelectedConnectionIds(activeConnection?.platform === 'facebook' ? [] : [activeAccountId]);\n    navigate('create');",
  );

  live = live.replace(
`              onConnect={(platform, id) => void connectSocial(platform, id)}
              onRefresh={() => setRefreshIndex((value) => value + 1)}`,
`              onConnect={(platform, id) => void connectSocial(platform, id)}
              onConnectMeta={() => void connectMeta()}
              onRefresh={() => setRefreshIndex((value) => value + 1)}`,
  );

  live = live.replace(
`          ready={{
            instagram: Boolean(runtime.instagramOAuthReady),
            youtube: Boolean(runtime.youtubeOAuthReady),
            tiktok: Boolean(runtime.tiktokOAuthReady),
          }}
          onClose={() => setAccountPanelOpen(false)}
          onConnect={(platform, id) => void connectSocial(platform, id)}`,
`          ready={{
            instagram: Boolean(runtime.instagramOAuthReady),
            youtube: Boolean(runtime.youtubeOAuthReady),
            tiktok: Boolean(runtime.tiktokOAuthReady),
          }}
          metaReady={Boolean(runtime.metaOAuthReady)}
          onClose={() => setAccountPanelOpen(false)}
          onConnect={(platform, id) => void connectSocial(platform, id)}
          onConnectMeta={() => void connectMeta()}`,
  );

  live = live.replace(
`function SettingsPage({ session, connections, runtime, onConnect, onRefresh }: {
  session: SessionPayload;
  connections: LiveConnection[];
  runtime: LiveRuntimeStateV3;
  onConnect: (platform: SocialPlatform, id?: string) => void;
  onRefresh: () => void;`,
`function SettingsPage({ session, connections, runtime, onConnect, onConnectMeta, onRefresh }: {
  session: SessionPayload;
  connections: LiveConnection[];
  runtime: LiveRuntimeStateV3;
  onConnect: (platform: SocialPlatform, id?: string) => void;
  onConnectMeta: () => void;
  onRefresh: () => void;`,
  );

  live = live.replace(
`{connection.status !== 'connected' && <button disabled={!ready[connection.platform]} onClick={() => onConnect(connection.platform, connection.id)}>Reconnecter</button>}`,
`{connection.status !== 'connected' && <button disabled={connection.platform === 'facebook' ? !runtime.metaOAuthReady : !ready[connection.platform]} onClick={() => connection.platform === 'facebook' ? onConnectMeta() : onConnect(connection.platform, connection.id)}>Reconnecter</button>}`,
  );

  live = live.replace(
`          <div className="sc10-settings-connect">
            {providers.map((provider) => <button`,
`          <div className="sc10-settings-connect">
            <button className="sc14-meta-provider" disabled={!runtime.metaOAuthReady} onClick={onConnectMeta}><span className="sc14-meta-icons"><PlatformMark platform="facebook" /><PlatformMark platform="instagram" /></span><span><strong>Connecter Facebook & Instagram</strong><small>{runtime.metaOAuthReady ? 'Une autorisation Meta, plusieurs comptes' : 'Configuration Meta requise'}</small></span><ChevronRight size={16} /></button>
            {providers.map((provider) => <button`,
  );

  live = live.replace(
`function AccountPanel({ connections, ready, onClose, onConnect, onSwitch }: {
  connections: LiveConnection[];
  ready: Record<SocialPlatform, boolean>;
  onClose: () => void;
  onConnect: (platform: SocialPlatform, id?: string) => void;
  onSwitch: (id: ActiveAccount) => void;`,
`function AccountPanel({ connections, ready, metaReady, onClose, onConnect, onConnectMeta, onSwitch }: {
  connections: LiveConnection[];
  ready: Record<SocialPlatform, boolean>;
  metaReady: boolean;
  onClose: () => void;
  onConnect: (platform: SocialPlatform, id?: string) => void;
  onConnectMeta: () => void;
  onSwitch: (id: ActiveAccount) => void;`,
  );

  live = live.replace(
`onClick={() => connection.status === 'connected' ? onSwitch(connection.id) : ready[connection.platform] && onConnect(connection.platform, connection.id)}`,
`onClick={() => connection.status === 'connected' ? onSwitch(connection.id) : connection.platform === 'facebook' ? metaReady && onConnectMeta() : ready[connection.platform] && onConnect(connection.platform, connection.id)}`,
  );
  live = live.replace(
`{connection.status === 'connected' ? 'Connecté' : ready[connection.platform] ? 'Reconnecter' : 'À configurer'}`,
`{connection.status === 'connected' ? 'Connecté' : connection.platform === 'facebook' ? (metaReady ? 'Reconnecter' : 'À configurer') : ready[connection.platform] ? 'Reconnecter' : 'À configurer'}`,
  );

  live = live.replace(
`          <div className="sc10-provider-list">
            {providers.map((provider) => <button`,
`          <div className="sc10-provider-list">
            <button className="sc14-meta-provider" disabled={!metaReady} onClick={onConnectMeta}><span className="sc14-meta-icons"><PlatformMark platform="facebook" size={18} /><PlatformMark platform="instagram" size={18} /></span><span><strong>Facebook & Instagram</strong><small>{metaReady ? 'Connecter plusieurs Pages et comptes Instagram' : 'Configuration Meta requise'}</small></span>{metaReady ? <ChevronRight size={17} /> : <span className="sc10-wait">Bientôt</span>}</button>
            {providers.map((provider) => <button`,
  );
  live = live.replace('Instagram, YouTube ou TikTok', 'Facebook, Instagram, YouTube ou TikTok');
  live = live.replace('Les mots de passe restent chez Instagram, Google ou TikTok.', 'Les mots de passe restent chez Meta, Google ou TikTok.');
  live = live.replace("if (error.code === 'OAUTH_NOT_CONFIGURED') return 'La connexion Instagram doit encore être configurée côté serveur.';", "if (error.code === 'OAUTH_NOT_CONFIGURED') return 'La connexion sociale doit encore être configurée côté serveur.';");

  live += '\n/* sc14-meta-provider marker */\n';
  fs.writeFileSync(livePath, live);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes('metaOAuthReady?: boolean;')) {
  main = main.replace('  tiktokOAuthReady?: boolean;\n', '  tiktokOAuthReady?: boolean;\n  metaOAuthReady?: boolean;\n');
}
if (!main.includes("./meta-connect.css")) {
  main = main.replace("import './planner-readiness-status.css';", "import './planner-readiness-status.css';\nimport './meta-connect.css';");
}
fs.writeFileSync(mainPath, main);

console.log('Meta multi-account OAuth backend and UI applied.');
