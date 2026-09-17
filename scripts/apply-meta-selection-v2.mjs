import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Meta selection v2 patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Production routes: authorize first, select assets second.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('META_SELECTION_ROUTES_V2')) {
  production = production.replace(
`import {
  completeMetaOAuth,
  MetaOAuthError,
  metaOAuthConfigured,
  startMetaOAuth,
} from './meta-oauth';`,
`import {
  completeMetaOAuth,
  completeMetaSelection,
  getMetaSelection,
  MetaOAuthError,
  metaOAuthConfigured,
  startMetaOAuth,
  type MetaRequestedPlatform,
} from './meta-oauth';`,
  );

  production = production.replace(
`  if (error.code === 'OAUTH_NOT_CONFIGURED') return Response.json({ error: error.message, code: error.code }, { status: 503 });
  if (error.code === 'INVALID_OAUTH_STATE' || error.code === 'OAUTH_STATE_EXPIRED') {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  return Response.json({ error: error.message, code: error.code }, { status: 502 });`,
`  if (error.code === 'OAUTH_NOT_CONFIGURED' || error.code === 'OAUTH_STORAGE_FAILED') {
    return Response.json({ error: error.message, code: error.code }, { status: 503 });
  }
  if (error.code === 'SELECTION_NOT_FOUND') return Response.json({ error: error.message, code: error.code }, { status: 404 });
  if (error.code === 'INVALID_OAUTH_STATE' || error.code === 'OAUTH_STATE_EXPIRED' || error.code === 'SELECTION_EXPIRED' || error.code === 'INVALID_SELECTION') {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  return Response.json({ error: error.message, code: error.code }, { status: 502 });`,
  );

  production = production.replace(
`  try {
    return Response.json(await startMetaOAuth(env.DB, env, auth.principal), { status: 201 });
  } catch (error) {
    if (error instanceof MetaOAuthError) return metaOauthErrorResponse(error);
    throw error;
  }`,
`  const body = await request.json().catch(() => undefined) as { platform?: unknown } | undefined;
  const requestedPlatform: MetaRequestedPlatform = body?.platform === 'instagram' ? 'instagram' : 'facebook';
  try {
    return Response.json(await startMetaOAuth(env.DB, env, auth.principal, requestedPlatform), { status: 201 });
  } catch (error) {
    if (error instanceof MetaOAuthError) return metaOauthErrorResponse(error);
    console.error(JSON.stringify({ event: 'meta_oauth_start_failed', message: error instanceof Error ? error.message : 'unknown' }));
    return Response.json({ error: 'La connexion Meta n’a pas pu démarrer.', code: 'META_OAUTH_START_FAILED' }, { status: 503 });
  }`,
  );

  const redirectStart = production.indexOf("function metaOauthRedirect(env: Env, outcome: 'connected' | 'error'");
  const callbackStart = production.indexOf('async function handleMetaOAuthCallback(', redirectStart);
  if (redirectStart < 0 || callbackStart < 0) throw new Error('Meta selection v2 patch failed: redirect function not found.');
  production = production.slice(0, redirectStart) + `function metaOauthRedirect(env: Env, outcome: 'select' | 'error', selectionId?: string): string {
  const configured = Reflect.get(env, 'META_REDIRECT_URI');
  try {
    const base = new URL(typeof configured === 'string' ? configured : 'https://social.neptunebusiness.com/');
    base.pathname = '/';
    base.search = outcome === 'select' && selectionId
      ? '?oauth=meta-select&selection=' + encodeURIComponent(selectionId)
      : '?oauth=meta-error';
    base.hash = '';
    return base.toString();
  } catch {
    return outcome === 'select' && selectionId
      ? 'https://social.neptunebusiness.com/?oauth=meta-select&selection=' + encodeURIComponent(selectionId)
      : 'https://social.neptunebusiness.com/?oauth=meta-error';
  }
}

` + production.slice(callbackStart);

  production = production.replace(
`        location: metaOauthRedirect(env, 'connected', result.connectedCount),`,
`        location: metaOauthRedirect(env, 'select', result.selectionId),`,
  );

  const dispatchAnchor = 'async function dispatchPending(env: Env): Promise<number> {';
  if (!production.includes(dispatchAnchor)) throw new Error('Meta selection v2 patch failed: dispatch anchor missing.');
  production = production.replace(dispatchAnchor, `async function handleMetaSelection(request: Request, env: Env, selectionId: string): Promise<Response> {
  const auth = await authenticateMutation(request, env, '/api/oauth/meta/selection');
  if (!auth.ok) return auth.response;
  if (auth.principal.role !== 'admin' && auth.principal.role !== 'manager') {
    return Response.json({ error: 'Only workspace administrators or managers can connect social accounts.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
  }
  try {
    if (request.method === 'GET') {
      return Response.json(await getMetaSelection(env.DB, env, auth.principal, selectionId));
    }
    const body = await request.json().catch(() => undefined) as { assetKeys?: unknown } | undefined;
    const assetKeys = Array.isArray(body?.assetKeys)
      ? body.assetKeys.filter((key): key is string => typeof key === 'string')
      : [];
    return Response.json(await completeMetaSelection(env.DB, env, auth.principal, selectionId, assetKeys));
  } catch (error) {
    if (error instanceof MetaOAuthError) return metaOauthErrorResponse(error);
    console.error(JSON.stringify({ event: 'meta_selection_failed', message: error instanceof Error ? error.message : 'unknown' }));
    return Response.json({ error: 'La sélection Meta n’a pas pu être enregistrée.', code: 'META_SELECTION_FAILED' }, { status: 503 });
  }
}

${dispatchAnchor}`);

  production = production.replace(
`    if (url.pathname === '/api/oauth/meta/start' && request.method === 'POST') {
      return handleMetaOAuthStart(request, env);
    }
    const socialStart = url.pathname.match(/^\/api\/oauth\/(youtube|tiktok)\/start$/);`,
`    if (url.pathname === '/api/oauth/meta/start' && request.method === 'POST') {
      return handleMetaOAuthStart(request, env);
    }
    const metaSelection = url.pathname.match(/^\/api\/oauth\/meta\/selection\/([0-9a-f-]{36})$/i);
    if (metaSelection && (request.method === 'GET' || request.method === 'POST')) {
      return handleMetaSelection(request, env, metaSelection[1]);
    }
    const socialStart = url.pathname.match(/^\/api\/oauth\/(youtube|tiktok)\/start$/);`,
  );

  production += '\n// META_SELECTION_ROUTES_V2\n';
  fs.writeFileSync(productionPath, production);
}

// Live UI: separate providers and explicit account selection.
const livePath = 'src/LiveAppV3.tsx';
let live = fs.readFileSync(livePath, 'utf8');
if (!live.includes('SC_META_SELECTION_V2')) {
  live = live.replace(
    `type AiDraftPayload = { draft: { id: string; body: string } };`,
    `type AiDraftPayload = { draft: { id: string; body: string } };
type MetaSelectionPayload = {
  selectionId: string;
  platform: 'facebook' | 'instagram';
  assets: Array<{ key: string; platform: 'facebook' | 'instagram'; externalAccountId: string; displayName: string; handle?: string }>;
};`,
  );

  live = live.replace(
`  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [toast, setToast] = useState('');`,
`  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [metaSelectionId, setMetaSelectionId] = useState<string>();
  const [metaSelection, setMetaSelection] = useState<MetaSelectionPayload>();
  const [metaSelectedKeys, setMetaSelectedKeys] = useState<string[]>([]);
  const [metaSelectionBusy, setMetaSelectionBusy] = useState(false);`,
  );

  live = live.replace(
`  useEffect(() => {
    window.localStorage.setItem('social-conversion.active-account', activeAccountId);
  }, [activeAccountId]);`,
`  useEffect(() => {
    const current = new URL(window.location.href);
    if (current.searchParams.get('oauth') !== 'meta-select') return;
    const selection = current.searchParams.get('selection');
    if (selection) setMetaSelectionId(selection);
    current.searchParams.delete('oauth');
    current.searchParams.delete('selection');
    const next = current.pathname + (current.searchParams.toString() ? '?' + current.searchParams.toString() : '') + current.hash;
    window.history.replaceState({}, '', next);
  }, []);

  useEffect(() => {
    if (!workspaceId || !metaSelectionId) return undefined;
    let active = true;
    setMetaSelectionBusy(true);
    apiRequest<MetaSelectionPayload>(\`/api/oauth/meta/selection/\${encodeURIComponent(metaSelectionId)}\`, {}, workspaceId)
      .then((payload) => {
        if (!active) return;
        setMetaSelection(payload);
        setMetaSelectedKeys(payload.assets.length === 1 ? [payload.assets[0].key] : []);
      })
      .catch((error) => {
        if (!active) return;
        setToast(readableError(error));
        setMetaSelectionId(undefined);
      })
      .finally(() => active && setMetaSelectionBusy(false));
    return () => { active = false; };
  }, [workspaceId, metaSelectionId]);

  useEffect(() => {
    window.localStorage.setItem('social-conversion.active-account', activeAccountId);
  }, [activeAccountId]);`,
  );

  live = live.replace(
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
  }`,
`  async function connectMeta(platform: 'facebook' | 'instagram') {
    if (!workspaceId) return;
    if (!runtime.metaOAuthReady) {
      setToast('La connexion Meta doit encore être configurée côté serveur.');
      return;
    }
    try {
      const result = await apiRequest<{ url: string }>('/api/oauth/meta/start', {
        method: 'POST',
        body: JSON.stringify({ platform }),
      }, workspaceId);
      window.location.assign(result.url);
    } catch (error) {
      setToast(readableError(error));
    }
  }

  async function completeMetaAssetSelection() {
    if (!workspaceId || !metaSelectionId || !metaSelectedKeys.length || metaSelectionBusy) return;
    setMetaSelectionBusy(true);
    try {
      const result = await apiRequest<{ connectedCount: number }>(\`/api/oauth/meta/selection/\${encodeURIComponent(metaSelectionId)}\`, {
        method: 'POST',
        body: JSON.stringify({ assetKeys: metaSelectedKeys }),
      }, workspaceId);
      setMetaSelectionId(undefined);
      setMetaSelection(undefined);
      setMetaSelectedKeys([]);
      setRefreshIndex((value) => value + 1);
      setToast(result.connectedCount + ' compte' + (result.connectedCount > 1 ? 's' : '') + ' connecté' + (result.connectedCount > 1 ? 's' : '') + '.');
    } catch (error) {
      setToast(readableError(error));
    } finally {
      setMetaSelectionBusy(false);
    }
  }`,
  );

  live = live.replaceAll('onConnectMeta={() => void connectMeta()}', 'onConnectMeta={(platform) => void connectMeta(platform)}');
  live = live.replaceAll('onConnectMeta: () => void;', "onConnectMeta: (platform: 'facebook' | 'instagram') => void;");
  live = live.replaceAll("const providers: SocialPlatform[] = ['instagram', 'youtube', 'tiktok'];", "const providers: SocialPlatform[] = ['youtube', 'tiktok'];");

  live = live.replace(
`            <button className="sc14-meta-provider" disabled={!runtime.metaOAuthReady} onClick={onConnectMeta}><span className="sc14-meta-icons"><PlatformMark platform="facebook" /><PlatformMark platform="instagram" /></span><span><strong>Connecter Facebook & Instagram</strong><small>{runtime.metaOAuthReady ? 'Une autorisation Meta, plusieurs comptes' : 'Configuration Meta requise'}</small></span><ChevronRight size={16} /></button>`,
`            <button className="sc15-provider-meta" disabled={!runtime.metaOAuthReady} onClick={() => onConnectMeta('facebook')}><PlatformMark platform="facebook" /><span><strong>Connecter Facebook</strong><small>{runtime.metaOAuthReady ? 'Choisir une ou plusieurs Pages' : 'Configuration Meta requise'}</small></span><ChevronRight size={16} /></button>
            <button className="sc15-provider-meta" disabled={!runtime.metaOAuthReady} onClick={() => onConnectMeta('instagram')}><PlatformMark platform="instagram" /><span><strong>Connecter Instagram</strong><small>{runtime.metaOAuthReady ? 'Choisir un ou plusieurs comptes professionnels' : 'Configuration Meta requise'}</small></span><ChevronRight size={16} /></button>`,
  );

  live = live.replace(
`            <button className="sc14-meta-provider" disabled={!metaReady} onClick={onConnectMeta}><span className="sc14-meta-icons"><PlatformMark platform="facebook" size={18} /><PlatformMark platform="instagram" size={18} /></span><span><strong>Facebook & Instagram</strong><small>{metaReady ? 'Connecter plusieurs Pages et comptes Instagram' : 'Configuration Meta requise'}</small></span>{metaReady ? <ChevronRight size={17} /> : <span className="sc10-wait">Bientôt</span>}</button>`,
`            <button className="sc15-provider-meta" disabled={!metaReady} onClick={() => onConnectMeta('facebook')}><PlatformMark platform="facebook" size={18} /><span><strong>Facebook</strong><small>{metaReady ? 'Choisir une ou plusieurs Pages' : 'Configuration Meta requise'}</small></span>{metaReady ? <ChevronRight size={17} /> : <span className="sc10-wait">Bientôt</span>}</button>
            <button className="sc15-provider-meta" disabled={!metaReady} onClick={() => onConnectMeta('instagram')}><PlatformMark platform="instagram" size={18} /><span><strong>Instagram</strong><small>{metaReady ? 'Choisir un ou plusieurs comptes professionnels' : 'Configuration Meta requise'}</small></span>{metaReady ? <ChevronRight size={17} /> : <span className="sc10-wait">Bientôt</span>}</button>`,
  );

  live = live.replace(
`connection.platform === 'facebook' ? onConnectMeta() : onConnect(connection.platform, connection.id)`,
`connection.platform === 'facebook' || (connection.platform === 'instagram' && runtime.metaOAuthReady) ? onConnectMeta(connection.platform as 'facebook' | 'instagram') : onConnect(connection.platform as SocialPlatform, connection.id)`,
  );
  live = live.replace(
`connection.platform === 'facebook' ? metaReady && onConnectMeta() : ready[connection.platform] && onConnect(connection.platform, connection.id)`,
`connection.platform === 'facebook' || (connection.platform === 'instagram' && metaReady) ? metaReady && onConnectMeta(connection.platform as 'facebook' | 'instagram') : ready[connection.platform as SocialPlatform] && onConnect(connection.platform as SocialPlatform, connection.id)`,
  );

  live = live.replace(
`          <h3>Comptes sociaux</h3>
          <div className="sc10-settings-list">`,
`          <h3>Comptes sociaux</h3>
          <div className="sc15-section-label">Comptes connectés</div>
          <div className="sc10-settings-list">`,
  );
  live = live.replace(
`            {connections.map((connection) => <div className="sc10-setting-account"`,
`            {connections.filter((connection) => connection.status === 'connected').map((connection) => <div className="sc10-setting-account"`,
  );
  live = live.replace(
`          <div className="sc10-settings-connect">`,
`          {connections.some((connection) => connection.status !== 'connected') && <>
            <div className="sc15-section-label">À reconnecter</div>
            <div className="sc15-attention-list">{connections.filter((connection) => connection.status !== 'connected').map((connection) => <div className="sc10-setting-account" key={connection.id}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span><b>À reconnecter</b><button onClick={() => connection.platform === 'facebook' || (connection.platform === 'instagram' && runtime.metaOAuthReady) ? onConnectMeta(connection.platform as 'facebook' | 'instagram') : onConnect(connection.platform as SocialPlatform, connection.id)}>Reconnecter</button></div>)}</div>
          </>}
          <div className="sc15-connect-label">Ajouter un compte</div>
          <div className="sc10-settings-connect">`,
  );

  live = live.replace(
`          <div className="sc10-connected-list">
            {connections.map((connection) => <button`,
`          <div className="sc15-account-heading">Comptes connectés</div>
          <div className="sc10-connected-list">
            {connections.filter((connection) => connection.status === 'connected').map((connection) => <button`,
  );
  live = live.replace(
`          </div>
          <button className="sc10-add-account" onClick={() => setMode('add')}>`,
`          </div>
          {connections.some((connection) => connection.status !== 'connected') && <>
            <div className="sc15-reconnect-heading">À reconnecter</div>
            <div className="sc10-connected-list sc15-attention-list">{connections.filter((connection) => connection.status !== 'connected').map((connection) => <button key={connection.id} className="pending" onClick={() => connection.platform === 'facebook' || (connection.platform === 'instagram' && metaReady) ? metaReady && onConnectMeta(connection.platform as 'facebook' | 'instagram') : ready[connection.platform as SocialPlatform] && onConnect(connection.platform as SocialPlatform, connection.id)}><PlatformMark platform={connection.platform} /><span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span><b>Reconnecter</b><ChevronRight size={15} /></button>)}</div>
          </>}
          <button className="sc10-add-account" onClick={() => setMode('add')}>`,
  );

  const settingsIndex = live.indexOf('function SettingsPage(');
  if (settingsIndex < 0) throw new Error('Meta selection v2 patch failed: SettingsPage not found.');
  const dialog = `function MetaSelectionDialog({ payload, selectedKeys, busy, onToggle, onSelectAll, onConfirm, onClose }: {
  payload?: MetaSelectionPayload;
  selectedKeys: string[];
  busy: boolean;
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const label = payload?.platform === 'instagram' ? 'Instagram' : 'Facebook';
  return (
    <div className="sc3-modal-backdrop centered" onMouseDown={onClose}>
      <section className="sc15-meta-selection" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Connexion Meta</small><h2>Choisir vos comptes {label}</h2></div><button onClick={onClose}><X size={18} /></button></header>
        <p className="sc15-selection-copy">L’autorisation Meta donne accès aux comptes que vous gérez. Social Conversion ne connectera que ceux que vous cochez ici.</p>
        {busy && !payload ? <div className="sc15-selection-empty"><LoaderCircle className="sc3-spin" size={18} /> Chargement des comptes…</div> : null}
        {payload && payload.assets.length > 0 ? <div className="sc15-selection-list">
          {payload.assets.map((asset) => <label key={asset.key} className={\`sc15-selection-row \${selectedKeys.includes(asset.key) ? 'active' : ''}\`}><input type="checkbox" checked={selectedKeys.includes(asset.key)} onChange={() => onToggle(asset.key)} /><PlatformMark platform={asset.platform} size={17} /><span><strong>{asset.displayName}</strong><small>{asset.handle || (asset.platform === 'facebook' ? 'Page Facebook' : 'Compte Instagram professionnel')}</small></span></label>)}
        </div> : null}
        {payload && !payload.assets.length ? <div className="sc15-selection-empty">Aucun compte disponible avec cette autorisation.</div> : null}
        <div className="sc15-selection-actions"><small>{payload?.assets.length ? <button type="button" className="sc3-secondary" onClick={onSelectAll}>{selectedKeys.length === payload.assets.length ? 'Tout désélectionner' : 'Tout sélectionner'}</button> : null}</small><button disabled={busy || !selectedKeys.length} onClick={onConfirm}>{busy ? 'Connexion…' : 'Connecter ' + selectedKeys.length + ' compte' + (selectedKeys.length > 1 ? 's' : '')}</button></div>
      </section>
    </div>
  );
}

`;
  live = live.slice(0, settingsIndex) + dialog + live.slice(settingsIndex);

  live = live.replace(
`      {accountPanelOpen && (
        <AccountPanel`,
`      {metaSelectionId && (
        <MetaSelectionDialog
          payload={metaSelection}
          selectedKeys={metaSelectedKeys}
          busy={metaSelectionBusy}
          onToggle={(key) => setMetaSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])}
          onSelectAll={() => setMetaSelectedKeys((current) => metaSelection && current.length === metaSelection.assets.length ? [] : (metaSelection?.assets.map((asset) => asset.key) ?? []))}
          onConfirm={() => void completeMetaAssetSelection()}
          onClose={() => { setMetaSelectionId(undefined); setMetaSelection(undefined); setMetaSelectedKeys([]); }}
        />
      )}
      {accountPanelOpen && (
        <AccountPanel`,
  );

  live += '\n/* SC_META_SELECTION_V2 */\n';
  fs.writeFileSync(livePath, live);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./account-connections-v2.css")) {
  main = main.replace("import './meta-connect.css';", "import './meta-connect.css';\nimport './account-connections-v2.css';");
  fs.writeFileSync(mainPath, main);
}

console.log('Explicit Facebook/Instagram asset selection and account separation applied.');
