import fs from 'node:fs';

const marker = 'SC_MULTI_ACCOUNT_SWITCHER_V1';

function assertReplace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Multi-account patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// ---- Live UI: deterministic account filtering + explicit "all accounts" state ----
const livePath = 'src/LiveAppV3.tsx';
let live = fs.readFileSync(livePath, 'utf8');
if (!live.includes(marker)) {
  if (!live.includes('  connectionId?: string;')) {
    live = assertReplace(
      live,
      `  accountName?: string;\n  status: string;`,
      `  accountName?: string;\n  connectionId?: string;\n  status: string;`,
      'conversation connection id type',
    );
  }

  live = assertReplace(
    live,
    `    const accountName = activeConnection?.displayName;\n    return inbox.conversations.filter((conversation) => {\n      if (accountName && conversation.accountName !== accountName) return false;`,
    `    const connectionId = activeConnection?.id;\n    return inbox.conversations.filter((conversation) => {\n      if (connectionId && conversation.connectionId !== connectionId) return false;`,
    'inbox account filter',
  );

  const switchStart = live.indexOf('  function switchAccount(id: ActiveAccount) {');
  const switchEnd = live.indexOf('\n\n  async function ', switchStart);
  if (switchStart < 0 || switchEnd < 0) throw new Error('Multi-account patch failed: switchAccount function not found.');
  live = live.slice(0, switchStart) + `  function switchAccount(id: ActiveAccount) {
    setAccountPanelOpen(false);
    setActiveAccountId(id);
    setSelectedConversationId(undefined);
    if (id !== 'all' && page === 'create') {
      const selected = connectedConnections.find((connection) => connection.id === id);
      setSelectedConnectionIds(selected?.platform === 'facebook' ? [] : [id]);
    }
  }` + live.slice(switchEnd);

  if (!live.includes('activeAccountId={activeAccountId}')) {
    live = assertReplace(
      live,
      `          onSwitch={switchAccount}\n        />`,
      `          activeAccountId={activeAccountId}\n          onSwitch={switchAccount}\n        />`,
      'AccountPanel active account prop',
    );
  }

  const accountPanelStart = live.indexOf('function AccountPanel(');
  const uploadDialogStart = live.indexOf('function UploadDialog(', accountPanelStart);
  if (accountPanelStart < 0 || uploadDialogStart < 0) throw new Error('Multi-account patch failed: AccountPanel boundaries not found.');

  const accountPanel = `function AccountPanel({ connections, ready, metaReady, onClose, onConnect, onConnectMeta, activeAccountId, onSwitch }: {
  connections: LiveConnection[];
  ready: Record<SocialPlatform, boolean>;
  metaReady: boolean;
  onClose: () => void;
  onConnect: (platform: SocialPlatform, id?: string) => void;
  onConnectMeta: (platform: 'facebook' | 'instagram') => void;
  activeAccountId: ActiveAccount;
  onSwitch: (id: ActiveAccount) => void;
}) {
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const connected = connections.filter((connection) => connection.status === 'connected');
  const reconnect = connections.filter((connection) => connection.status !== 'connected');
  const countFor = (platform: ConnectionPlatform) => connected.filter((connection) => connection.platform === platform).length;

  const reconnectAccount = (connection: LiveConnection) => {
    if (connection.platform === 'facebook') {
      if (metaReady) onConnectMeta('facebook');
      return;
    }
    if (ready[connection.platform]) onConnect(connection.platform, connection.id);
  };

  const providerHint = (platform: ConnectionPlatform, emptyLabel: string) => {
    const count = countFor(platform);
    if (!count) return emptyLabel;
    return count + ' déjà connecté' + (count > 1 ? 's' : '') + ' · ajouter un autre compte';
  };

  return (
    <div className="sc3-modal-backdrop" onMouseDown={onClose}>
      <section className="sc3-account-panel sc10-account-panel sc16-account-panel" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>{mode === 'add' && <button type="button" className="sc10-back" onClick={() => setMode('list')}><ChevronLeft size={16} /></button>}<span><small>Comptes sociaux</small><h2>{mode === 'list' ? 'Vos comptes' : 'Ajouter un compte'}</h2></span></div>
          <button type="button" onClick={onClose}><X size={18} /></button>
        </header>

        {mode === 'list' ? <>
          <button
            type="button"
            className={'sc3-panel-account sc10-all-accounts sc16-all-accounts' + (activeAccountId === 'all' ? ' is-active' : '')}
            aria-pressed={activeAccountId === 'all'}
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); onSwitch('all'); }}
          >
            <span className="sc3-all-mark">∞</span>
            <span><strong>Tous les comptes</strong><small>Afficher ensemble le Planner et l’Inbox</small></span>
            {activeAccountId === 'all' ? <span className="sc16-selected"><Check size={13} /> Sélectionné</span> : <ChevronRight size={16} />}
          </button>

          <div className="sc16-section-title">Comptes connectés <span>{connected.length}</span></div>
          <div className="sc10-connected-list sc16-connected-list">
            {connected.map((connection) => {
              const selected = activeAccountId === connection.id;
              return <button
                type="button"
                key={connection.id}
                className={'sc16-account-row' + (selected ? ' is-active' : '')}
                aria-pressed={selected}
                onClick={() => onSwitch(connection.id)}
              >
                <PlatformMark platform={connection.platform} />
                <span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span>
                <span className={'sc16-account-status' + (selected ? ' is-active' : '')}>{selected ? <><Check size={12} /> Actif</> : 'Connecté'}</span>
              </button>;
            })}
            {!connected.length && <div className="sc16-empty">Aucun compte connecté pour le moment.</div>}
          </div>

          {reconnect.length > 0 && <>
            <div className="sc16-section-title warning">À reconnecter <span>{reconnect.length}</span></div>
            <div className="sc10-connected-list sc16-connected-list sc16-reconnect-list">
              {reconnect.map((connection) => <button
                type="button"
                key={connection.id}
                disabled={connection.platform === 'facebook' ? !metaReady : !ready[connection.platform]}
                onClick={() => reconnectAccount(connection)}
              >
                <PlatformMark platform={connection.platform} />
                <span><strong>{connection.displayName}</strong><small>{connection.handle || platformLabel(connection.platform)}</small></span>
                <span className="sc16-account-status warning">Reconnecter</span>
              </button>)}
            </div>
          </>}

          <button type="button" className="sc10-add-account sc16-add-account" onClick={() => setMode('add')}>
            <Plus size={17} />
            <span><strong>Ajouter un compte</strong><small>Plusieurs comptes peuvent être connectés sur chaque réseau</small></span>
            <ChevronRight size={16} />
          </button>
        </> : <>
          <div className="sc10-add-intro sc16-add-intro">
            <strong>Quel compte voulez-vous ajouter ?</strong>
            <small>Chaque connexion est indépendante. Vous pouvez ajouter plusieurs comptes Instagram, Facebook, YouTube ou TikTok dans le même espace.</small>
          </div>
          <div className="sc10-provider-list sc16-provider-list">
            <button type="button" className="sc15-provider-meta" disabled={!metaReady} onClick={() => onConnectMeta('facebook')}>
              <PlatformMark platform="facebook" size={18} />
              <span><strong>Facebook</strong><small>{metaReady ? providerHint('facebook', 'Choisir une ou plusieurs Pages') : 'Configuration Meta requise'}</small></span>
              {metaReady ? <ChevronRight size={17} /> : <span className="sc10-wait">Bientôt</span>}
            </button>
            <button type="button" disabled={!ready.instagram} onClick={() => onConnect('instagram')}>
              <PlatformMark platform="instagram" size={19} />
              <span><strong>Instagram</strong><small>{ready.instagram ? providerHint('instagram', 'Ajouter un compte professionnel') : 'Configuration Instagram requise'}</small></span>
              {ready.instagram ? <ChevronRight size={17} /> : <span className="sc10-wait">Bientôt</span>}
            </button>
            <button type="button" disabled={!ready.youtube} onClick={() => onConnect('youtube')}>
              <PlatformMark platform="youtube" size={19} />
              <span><strong>YouTube</strong><small>{ready.youtube ? providerHint('youtube', 'Choisir une chaîne YouTube') : 'Configuration Google requise'}</small></span>
              {ready.youtube ? <ChevronRight size={17} /> : <span className="sc10-wait">Bientôt</span>}
            </button>
            <button type="button" disabled={!ready.tiktok} onClick={() => onConnect('tiktok')}>
              <PlatformMark platform="tiktok" size={19} />
              <span><strong>TikTok</strong><small>{ready.tiktok ? providerHint('tiktok', 'Ajouter un compte TikTok') : 'Configuration TikTok requise'}</small></span>
              {ready.tiktok ? <ChevronRight size={17} /> : <span className="sc10-wait">Bientôt</span>}
            </button>
          </div>
          <p className="sc10-security-note">Ajouter un compte ne remplace jamais les comptes déjà connectés. Si le même compte est autorisé une seconde fois, Social Conversion actualise sa connexion au lieu de créer un doublon.</p>
        </>}
      </section>
    </div>
  );
}

`;

  live = live.slice(0, accountPanelStart) + accountPanel + live.slice(uploadDialogStart);
  live += `\n/* ${marker} */\n`;
  fs.writeFileSync(livePath, live);
}

// ---- Inbox API: filter by stable connection id, not display name ----
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('MULTI_ACCOUNT_CONNECTION_ID_V1')) {
  liveData = assertReplace(
    liveData,
    `  platform: SocialPlatform;\n  account_name: string;`,
    `  platform: SocialPlatform;\n  connection_id: string;\n  account_name: string;`,
    'inbox row connection id',
  );
  liveData = assertReplace(
    liveData,
    `       sc.platform,\n       sc.display_name AS account_name,`,
    `       sc.platform,\n       c.connection_id,\n       sc.display_name AS account_name,`,
    'inbox select connection id',
  );
  liveData = assertReplace(
    liveData,
    `      platform: row.platform,\n      accountName: row.account_name,`,
    `      platform: row.platform,\n      connectionId: row.connection_id,\n      accountName: row.account_name,`,
    'inbox response connection id',
  );
  liveData += '\n// MULTI_ACCOUNT_CONNECTION_ID_V1\n';
  fs.writeFileSync(liveDataPath, liveData);
}

// ---- YouTube: when adding a NEW account, always show Google's account chooser ----
const socialOauthPath = 'src/worker/social-account-oauth.ts';
let socialOauth = fs.readFileSync(socialOauthPath, 'utf8');
if (!socialOauth.includes('MULTI_ACCOUNT_GOOGLE_CHOOSER_V1')) {
  socialOauth = assertReplace(
    socialOauth,
    `    authorize.searchParams.set('prompt', 'consent');`,
    `    authorize.searchParams.set('prompt', requestedConnectionId ? 'consent' : 'select_account consent');`,
    'Google account chooser',
  );
  socialOauth += '\n// MULTI_ACCOUNT_GOOGLE_CHOOSER_V1\n';
  fs.writeFileSync(socialOauthPath, socialOauth);
}

// ---- Instagram: repeated add is idempotent and stale pending attempts are cleaned ----
const instagramPath = 'src/worker/instagram-oauth.ts';
let instagram = fs.readFileSync(instagramPath, 'utf8');
if (!instagram.includes('MULTI_ACCOUNT_INSTAGRAM_V1')) {
  instagram = assertReplace(
    instagram,
    `  } else {\n    connectionId = \`ig:\${crypto.randomUUID()}\`;\n    const now = new Date().toISOString();`,
    `  } else {\n    const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();\n    await db.prepare(\n      \`DELETE FROM social_connections\n       WHERE workspace_id = ? AND platform = 'instagram' AND status = 'pending' AND external_account_id IS NULL\n         AND created_at < ?\n         AND NOT EXISTS (SELECT 1 FROM oauth_credentials oc WHERE oc.connection_id = social_connections.id)\n         AND NOT EXISTS (SELECT 1 FROM content_post_destinations d WHERE d.connection_id = social_connections.id)\n         AND NOT EXISTS (SELECT 1 FROM content_post_targets t WHERE t.connection_id = social_connections.id)\n         AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.connection_id = social_connections.id)\`\n    ).bind(principal.workspaceId, staleBefore).run();\n\n    connectionId = \`ig:\${crypto.randomUUID()}\`;\n    const now = new Date().toISOString();`,
    'Instagram stale pending cleanup',
  );

  const validationAnchor = `  if (shortPayload.user_id !== undefined && String(shortPayload.user_id) !== profileId) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram token identity does not match the returned professional account.');\n  }`;
  const validationWithIdentity = `${validationAnchor}\n\n  const stateConnection = await db.prepare(\n    \`SELECT external_account_id FROM social_connections\n     WHERE id = ? AND workspace_id = ? AND platform = 'instagram'\`,\n  ).bind(state.connection_id, state.workspace_id).first<{ external_account_id: string | null }>();\n  if (!stateConnection) {\n    throw new InstagramOAuthError('CONNECTION_NOT_FOUND', 'Instagram connection is unavailable.');\n  }\n  if (stateConnection.external_account_id && stateConnection.external_account_id !== profileId) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Reconnect the same Instagram account that belongs to this connection.');\n  }\n  const duplicate = stateConnection.external_account_id ? undefined : await db.prepare(\n    \`SELECT id FROM social_connections\n     WHERE workspace_id = ? AND platform = 'instagram' AND external_account_id = ? AND id <> ?\n     ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END, created_at ASC\n     LIMIT 1\`,\n  ).bind(state.workspace_id, profileId, state.connection_id).first<{ id: string }>();\n  const resolvedConnectionId = duplicate?.id ?? state.connection_id;`;
  instagram = assertReplace(instagram, validationAnchor, validationWithIdentity, 'Instagram canonical account resolution');

  const completeStart = instagram.indexOf('export async function completeInstagramOAuth(');
  const refreshStart = instagram.indexOf('export async function refreshExpiringInstagramTokens(', completeStart);
  if (completeStart < 0 || refreshStart < 0) throw new Error('Multi-account patch failed: Instagram completion boundaries not found.');
  let completion = instagram.slice(completeStart, refreshStart);
  completion = completion.replaceAll('      state.connection_id,\n      state.workspace_id,', '      resolvedConnectionId,\n      state.workspace_id,');
  completion = completion.replace('    connectionId: state.connection_id,\n    provider: \'instagram\',', '    connectionId: resolvedConnectionId,\n    provider: \'instagram\',');
  completion = completion.replace(
    `  await auditOAuth(db, state, 'oauth.instagram_connected', {`,
    `  if (resolvedConnectionId !== state.connection_id) {\n    await db.prepare(\n      \`DELETE FROM social_connections\n       WHERE id = ? AND workspace_id = ? AND platform = 'instagram'\n         AND status = 'pending' AND external_account_id IS NULL\`\n    ).bind(state.connection_id, state.workspace_id).run();\n  }\n\n  await auditOAuth(db, { ...state, connection_id: resolvedConnectionId }, 'oauth.instagram_connected', {`,
  );
  completion = completion.replace('    connectionId: state.connection_id,\n    accountId: profileId,', '    connectionId: resolvedConnectionId,\n    accountId: profileId,');
  instagram = instagram.slice(0, completeStart) + completion + instagram.slice(refreshStart);
  instagram += '\n// MULTI_ACCOUNT_INSTAGRAM_V1\n';
  fs.writeFileSync(instagramPath, instagram);
}

// ---- stylesheet import ----
const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./multi-account-switcher.css")) {
  main = main.replace("import './planner-readiness-status.css';", "import './planner-readiness-status.css';\nimport './multi-account-switcher.css';");
  fs.writeFileSync(mainPath, main);
}

console.log('Multi-account switcher, stable inbox filtering and repeatable account connections applied.');
