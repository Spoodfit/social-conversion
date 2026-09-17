import fs from 'node:fs';

const livePath = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(livePath, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Account connect UI v3 failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

if (!source.includes('sc10-account-panel')) {
  replaceOnce(
`  instagramOAuthReady?: boolean;
  publishingSchedulerReady?: boolean;`,
`  instagramOAuthReady?: boolean;
  youtubeOAuthReady?: boolean;
  tiktokOAuthReady?: boolean;
  publishingSchedulerReady?: boolean;`,
    'runtime readiness',
  );

  replaceOnce(
`  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);`,
`  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const current = new URL(window.location.href);
    const oauth = current.searchParams.get('oauth');
    const match = oauth?.match(/^(instagram|youtube|tiktok)-(connected|error)$/);
    if (!match) return;
    const platform = match[1] as SocialPlatform;
    const outcome = match[2];
    setToast(outcome === 'connected'
      ? platformLabel(platform) + ' est connecté.'
      : 'La connexion ' + platformLabel(platform) + ' n’a pas abouti. Vous pouvez réessayer.');
    current.searchParams.delete('oauth');
    const next = current.pathname + (current.searchParams.toString() ? '?' + current.searchParams.toString() : '') + current.hash;
    window.history.replaceState({}, '', next);
  }, []);`,
    'OAuth callback feedback',
  );

  replaceOnce(
`  async function connectInstagram(connectionId?: string) {
    if (!workspaceId) return;
    if (!runtime.instagramOAuthReady) {
      setToast('La connexion Instagram n’est pas encore configurée côté serveur.');
      return;
    }
    try {
      const result = await apiRequest<{ url: string }>('/api/oauth/instagram/start', {
        method: 'POST',
        body: JSON.stringify(connectionId ? { connectionId } : {}),
      }, workspaceId);
      window.location.assign(result.url);
    } catch (error) {
      setToast(readableError(error));
    }
  }`,
`  async function connectSocial(platform: SocialPlatform, connectionId?: string) {
    if (!workspaceId) return;
    const ready = platform === 'instagram'
      ? Boolean(runtime.instagramOAuthReady)
      : platform === 'youtube'
        ? Boolean(runtime.youtubeOAuthReady)
        : Boolean(runtime.tiktokOAuthReady);
    if (!ready) {
      setToast('La connexion ' + platformLabel(platform) + ' doit encore être configurée côté serveur.');
      return;
    }
    try {
      const result = await apiRequest<{ url: string }>('/api/oauth/' + platform + '/start', {
        method: 'POST',
        body: JSON.stringify(connectionId ? { connectionId } : {}),
      }, workspaceId);
      window.location.assign(result.url);
    } catch (error) {
      setToast(readableError(error));
    }
  }`,
    'connectInstagram only',
  );

  replaceOnce(
`              onConnectInstagram={(id) => void connectInstagram(id)}
              onRefresh={() => setRefreshIndex((value) => value + 1)}`,
`              onConnect={(platform, id) => void connectSocial(platform, id)}
              onRefresh={() => setRefreshIndex((value) => value + 1)}`,
    'settings props',
  );

  replaceOnce(
`        <AccountPanel
          connections={connections}
          instagramReady={Boolean(runtime.instagramOAuthReady)}
          onClose={() => setAccountPanelOpen(false)}
          onConnectInstagram={(id) => void connectInstagram(id)}
          onSwitch={switchAccount}
        />`,
`        <AccountPanel
          connections={connections}
          ready={{
            instagram: Boolean(runtime.instagramOAuthReady),
            youtube: Boolean(runtime.youtubeOAuthReady),
            tiktok: Boolean(runtime.tiktokOAuthReady),
          }}
          onClose={() => setAccountPanelOpen(false)}
          onConnect={(platform, id) => void connectSocial(platform, id)}
          onSwitch={switchAccount}
        />`,
    'account panel props',
  );

  replaceOnce(
`function SettingsPage({ session, connections, runtime, onConnectInstagram, onRefresh }: {
  session: SessionPayload;
  connections: LiveConnection[];
  runtime: LiveRuntimeStateV3;
  onConnectInstagram: (id?: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="sc3-settings-page">
      <div className="sc3-page-head compact"><div><h1>Réglages</h1><p>Uniquement les connexions et votre accès.</p></div><button className="sc3-secondary" onClick={onRefresh}><RefreshCw size={15} /> Actualiser</button></div>
      <div className="sc3-settings-grid">
        <section><h3>Comptes sociaux</h3>{connections.map((connection) => <div className="sc3-setting-account" key={connection.id}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || 'Identifiant non renseigné'}</small></span><b>{connection.status}</b>{connection.platform === 'instagram' && connection.status !== 'connected' && <button onClick={() => onConnectInstagram(connection.id)}>Reconnecter</button>}</div>)}<button className="sc3-connect-row" onClick={() => onConnectInstagram()} disabled={!runtime.instagramOAuthReady}><Plus size={16} /> Connecter Instagram</button></section>
        <section><h3>Votre accès</h3><p>{session.email || session.subject}</p><p>Rôle : <strong>{session.workspace.role}</strong></p><p>Espace : <strong>{session.workspace.name}</strong></p></section>
      </div>
    </div>
  );
}`,
`function SettingsPage({ session, connections, runtime, onConnect, onRefresh }: {
  session: SessionPayload;
  connections: LiveConnection[];
  runtime: LiveRuntimeStateV3;
  onConnect: (platform: SocialPlatform, id?: string) => void;
  onRefresh: () => void;
}) {
  const ready: Record<SocialPlatform, boolean> = {
    instagram: Boolean(runtime.instagramOAuthReady),
    youtube: Boolean(runtime.youtubeOAuthReady),
    tiktok: Boolean(runtime.tiktokOAuthReady),
  };
  const providers: SocialPlatform[] = ['instagram', 'youtube', 'tiktok'];
  return (
    <div className="sc3-settings-page">
      <div className="sc3-page-head compact"><div><h1>Réglages</h1><p>Vos comptes sociaux et votre accès.</p></div><button className="sc3-secondary" onClick={onRefresh}><RefreshCw size={15} /> Actualiser</button></div>
      <div className="sc3-settings-grid">
        <section className="sc10-settings-accounts">
          <h3>Comptes sociaux</h3>
          <div className="sc10-settings-list">
            {connections.map((connection) => <div className="sc10-setting-account" key={connection.id}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span><b className={connection.status === 'connected' ? 'ok' : ''}>{connection.status === 'connected' ? 'Connecté' : 'À reconnecter'}</b>{connection.status !== 'connected' && <button disabled={!ready[connection.platform]} onClick={() => onConnect(connection.platform, connection.id)}>Reconnecter</button>}</div>)}
            {!connections.length && <p className="sc10-no-account">Aucun compte connecté pour le moment.</p>}
          </div>
          <div className="sc10-settings-connect">
            {providers.map((provider) => <button key={provider} disabled={!ready[provider]} onClick={() => onConnect(provider)}><PlatformMark platform={provider} /><span><strong>Connecter {platformLabel(provider)}</strong><small>{ready[provider] ? 'Connexion sécurisée en quelques clics' : 'Configuration OAuth requise'}</small></span><ChevronRight size={16} /></button>)}
          </div>
        </section>
        <section><h3>Votre accès</h3><p>{session.email || session.subject}</p><p>Rôle : <strong>{session.workspace.role}</strong></p><p>Espace : <strong>{session.workspace.name}</strong></p></section>
      </div>
    </div>
  );
}`,
    'SettingsPage exact',
  );

  replaceOnce(
`function AccountPanel({ connections, instagramReady, onClose, onConnectInstagram, onSwitch }: {
  connections: LiveConnection[];
  instagramReady: boolean;
  onClose: () => void;
  onConnectInstagram: (id?: string) => void;
  onSwitch: (id: ActiveAccount) => void;
}) {
  return (
    <div className="sc3-modal-backdrop" onMouseDown={onClose}>
      <section className="sc3-account-panel" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Comptes sociaux</small><h2>Changer de compte</h2></div><button onClick={onClose}><X size={18} /></button></header>
        <button className="sc3-panel-account" onClick={() => onSwitch('all')}><span className="sc3-all-mark">∞</span><span><strong>Tous les comptes</strong><small>Vue globale</small></span><ChevronRight size={16} /></button>
        <div className="sc3-panel-list">{connections.map((connection) => <button key={connection.id} onClick={() => connection.status === 'connected' && onSwitch(connection.id)}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span><b className={connection.status === 'connected' ? 'ok' : ''}>{connection.status}</b></button>)}</div>
        <div className="sc3-connect-options"><button onClick={() => onConnectInstagram()} disabled={!instagramReady}><PlatformMark platform="instagram" /><span><strong>Ajouter Instagram</strong><small>{instagramReady ? 'Connexion OAuth' : 'Configuration serveur requise'}</small></span><Plus size={16} /></button><button disabled><PlatformMark platform="youtube" /><span><strong>Ajouter YouTube</strong><small>Connecteur non activé</small></span></button><button disabled><PlatformMark platform="tiktok" /><span><strong>Ajouter TikTok</strong><small>Accès partenaire requis</small></span></button></div>
      </section>
    </div>
  );
}`,
`function AccountPanel({ connections, ready, onClose, onConnect, onSwitch }: {
  connections: LiveConnection[];
  ready: Record<SocialPlatform, boolean>;
  onClose: () => void;
  onConnect: (platform: SocialPlatform, id?: string) => void;
  onSwitch: (id: ActiveAccount) => void;
}) {
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const providers: SocialPlatform[] = ['instagram', 'youtube', 'tiktok'];
  return (
    <div className="sc3-modal-backdrop" onMouseDown={onClose}>
      <section className="sc3-account-panel sc10-account-panel" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>{mode === 'add' && <button className="sc10-back" onClick={() => setMode('list')}><ChevronLeft size={16} /></button>}<span><small>Comptes sociaux</small><h2>{mode === 'list' ? 'Vos comptes' : 'Ajouter un compte'}</h2></span></div>
          <button onClick={onClose}><X size={18} /></button>
        </header>
        {mode === 'list' ? <>
          <button className="sc3-panel-account sc10-all-accounts" onClick={() => onSwitch('all')}><span className="sc3-all-mark">∞</span><span><strong>Tous les comptes</strong><small>Voir tout dans le Planner et l’Inbox</small></span><ChevronRight size={16} /></button>
          <div className="sc10-connected-list">
            {connections.map((connection) => <button key={connection.id} className={connection.status === 'connected' ? '' : 'pending'} onClick={() => connection.status === 'connected' ? onSwitch(connection.id) : ready[connection.platform] && onConnect(connection.platform, connection.id)}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span><b className={connection.status === 'connected' ? 'ok' : ''}>{connection.status === 'connected' ? 'Connecté' : ready[connection.platform] ? 'Reconnecter' : 'À configurer'}</b><ChevronRight size={15} /></button>)}
          </div>
          <button className="sc10-add-account" onClick={() => setMode('add')}><Plus size={17} /><span><strong>Ajouter un compte</strong><small>Instagram, YouTube ou TikTok</small></span><ChevronRight size={16} /></button>
        </> : <>
          <div className="sc10-add-intro"><strong>Quel réseau voulez-vous connecter ?</strong><small>Vous serez redirigé vers le réseau pour autoriser Social Conversion, puis ramené ici automatiquement.</small></div>
          <div className="sc10-provider-list">
            {providers.map((provider) => <button key={provider} disabled={!ready[provider]} onClick={() => onConnect(provider)}><PlatformMark platform={provider} size={19} /><span><strong>{platformLabel(provider)}</strong><small>{ready[provider] ? 'Connecter maintenant' : 'Configuration OAuth requise'}</small></span>{ready[provider] ? <ChevronRight size={17} /> : <span className="sc10-wait">Bientôt</span>}</button>)}
          </div>
          <p className="sc10-security-note">Les mots de passe restent chez Instagram, Google ou TikTok. Social Conversion ne stocke que les autorisations OAuth chiffrées nécessaires.</p>
        </>}
      </section>
    </div>
  );
}`,
    'AccountPanel exact',
  );

  fs.writeFileSync(livePath, source);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./account-connect.css")) {
  main = main.replace("import './guided-composer.css';", "import './guided-composer.css';\nimport './account-connect.css';");
}
if (!main.includes('youtubeOAuthReady?: boolean;')) {
  main = main.replace('  instagramOAuthReady?: boolean;\n', '  instagramOAuthReady?: boolean;\n  youtubeOAuthReady?: boolean;\n  tiktokOAuthReady?: boolean;\n');
}
fs.writeFileSync(mainPath, main);
console.log('Unified social account connection UI v3 applied safely.');
