import fs from 'node:fs';

function replaceOrThrow(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Account disconnect patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Backend: disconnect without deleting imported history. Credentials are revoked/wiped,
// while the connection row remains so the same account can be reconnected cleanly.
const workerPath = 'src/worker/cockpit-production.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('SC_ACCOUNT_DISCONNECT_V1')) {
  worker = replaceOrThrow(
    worker,
    'const cockpitProductionWorker = {',
`async function handleSocialConnectionDisconnect(
  request: Request,
  env: Env,
  connectionId: string,
): Promise<Response> {
  const auth = await authenticateWorkspace(request, env);
  if (!auth.ok) return auth.response;
  if (!isLive(env)) {
    return Response.json({ error: 'La gestion des connexions est indisponible.', code: 'LIVE_NOT_READY' }, { status: 503 });
  }
  if (auth.principal.role !== 'admin' && auth.principal.role !== 'manager') {
    return Response.json({ error: 'Seuls les administrateurs et managers peuvent déconnecter un compte.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { platform?: unknown };
  const platform = typeof body.platform === 'string' ? body.platform : '';
  if (!['facebook', 'instagram', 'youtube', 'tiktok', 'linkedin'].includes(platform)) {
    return Response.json({ error: 'Plateforme invalide.', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(connectionId)) {
    return Response.json({ error: 'Connexion introuvable.', code: 'CONNECTION_NOT_FOUND' }, { status: 404 });
  }

  const now = new Date().toISOString();
  let found: { id: string; display_name: string } | null = null;

  if (platform === 'facebook') {
    found = await env.DB.prepare(
      `SELECT id, display_name FROM facebook_connections WHERE id = ? AND workspace_id = ? LIMIT 1`,
    ).bind(connectionId, auth.principal.workspaceId).first<{ id: string; display_name: string }>();
    if (found) {
      await env.DB.prepare(
        `UPDATE facebook_connections
         SET status = 'revoked', capabilities_json = '{}', scopes_json = '[]',
             access_token_ciphertext = '', access_token_iv = '', access_key_version = '', updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
      ).bind(now, connectionId, auth.principal.workspaceId).run();
    }
  } else if (platform === 'linkedin') {
    found = await env.DB.prepare(
      `SELECT id, display_name FROM linkedin_connections WHERE id = ? AND workspace_id = ? LIMIT 1`,
    ).bind(connectionId, auth.principal.workspaceId).first<{ id: string; display_name: string }>();
    if (found) {
      await env.DB.prepare(
        `UPDATE linkedin_connections
         SET status = 'revoked', capabilities_json = '{}', scopes_json = '[]',
             access_token_ciphertext = '', access_token_iv = '', access_key_version = '',
             refresh_token_ciphertext = NULL, refresh_token_iv = NULL, refresh_key_version = NULL,
             access_expires_at = NULL, refresh_expires_at = NULL, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
      ).bind(now, connectionId, auth.principal.workspaceId).run();
    }
  } else {
    found = await env.DB.prepare(
      `SELECT id, display_name FROM social_connections
       WHERE id = ? AND workspace_id = ? AND platform = ? LIMIT 1`,
    ).bind(connectionId, auth.principal.workspaceId, platform).first<{ id: string; display_name: string }>();
    if (found) {
      await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM oauth_credentials WHERE connection_id = ? AND workspace_id = ?`,
        ).bind(connectionId, auth.principal.workspaceId),
        env.DB.prepare(
          `UPDATE social_connections
           SET status = 'revoked', capabilities_json = '{}', token_reference = NULL, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND platform = ?`,
        ).bind(now, connectionId, auth.principal.workspaceId, platform),
      ]);
    }
  }

  if (!found) {
    return Response.json({ error: 'Connexion introuvable dans cet espace.', code: 'CONNECTION_NOT_FOUND' }, { status: 404 });
  }

  await writeAuditLog(env.DB, auth.principal, 'social_connection.disconnected', 'social_connection', connectionId, {
    platform,
    displayName: found.display_name,
  });

  return Response.json({
    connection: {
      id: connectionId,
      platform,
      displayName: found.display_name,
      status: 'revoked',
    },
  });
}

const cockpitProductionWorker = {`,
    'backend disconnect handler',
  );

  worker = replaceOrThrow(
    worker,
    `    const response = await productionWorker.fetch(request, env, ctx);`,
    `    const connectionDisconnect = url.pathname.match(/^\\/api\\/social-connections\\/([^/]+)$/);
    if (connectionDisconnect && request.method === 'DELETE') {
      return handleSocialConnectionDisconnect(request, env, decodeURIComponent(connectionDisconnect[1] ?? ''));
    }

    const response = await productionWorker.fetch(request, env, ctx);`,
    'backend disconnect route',
  );

  worker += '\n// SC_ACCOUNT_DISCONNECT_V1\n';
  fs.writeFileSync(workerPath, worker);
}

// UI: every connected row gets an explicit disconnect action with confirmation.
const livePath = 'src/LiveAppV3.tsx';
let live = fs.readFileSync(livePath, 'utf8');
if (!live.includes('SC_ACCOUNT_DISCONNECT_UI_V1')) {
  const sendReplyAnchor = '  async function sendReply(event: FormEvent) {';
  live = replaceOrThrow(
    live,
    sendReplyAnchor,
`  async function disconnectSocialConnection(connection: LiveConnection) {
    if (!workspaceId) return;
    const confirmed = window.confirm(
      'Déconnecter ' + connection.displayName + ' ?\\n\\n' +
      'La synchronisation et les publications futures seront arrêtées. L’historique déjà importé restera dans Social Conversion.'
    );
    if (!confirmed) return;
    try {
      await apiRequest<{ connection: { id: string; status: string } }>(
        '/api/social-connections/' + encodeURIComponent(connection.id),
        {
          method: 'DELETE',
          body: JSON.stringify({ platform: connection.platform }),
        },
        workspaceId,
      );
      if (activeAccountId === connection.id) setActiveAccountId('all');
      setSelectedConnectionIds((current) => current.filter((id) => id !== connection.id));
      setRefreshIndex((value) => value + 1);
      setToast(platformLabel(connection.platform) + ' a été déconnecté. Vous pouvez le reconnecter à tout moment.');
    } catch (error) {
      setToast(readableError(error));
    }
  }

${sendReplyAnchor}`,
    'UI disconnect handler',
  );

  const settingsCallStart = live.indexOf("{page === 'settings' && (");
  if (settingsCallStart < 0) throw new Error('Account disconnect patch failed: SettingsPage call not found.');
  const settingsCallEnd = live.indexOf('/>', settingsCallStart);
  if (settingsCallEnd < 0) throw new Error('Account disconnect patch failed: SettingsPage call end not found.');
  let settingsCall = live.slice(settingsCallStart, settingsCallEnd + 2);
  if (!settingsCall.includes('onDisconnect=')) {
    const refreshProp = '              onRefresh={() => setRefreshIndex((value) => value + 1)}';
    if (!settingsCall.includes(refreshProp)) throw new Error('Account disconnect patch failed: SettingsPage refresh prop not found.');
    settingsCall = settingsCall.replace(
      refreshProp,
      `              onDisconnect={(connection) => void disconnectSocialConnection(connection)}\n${refreshProp}`,
    );
    live = live.slice(0, settingsCallStart) + settingsCall + live.slice(settingsCallEnd + 2);
  }

  const signatureStart = live.indexOf('function SettingsPage({ ');
  if (signatureStart < 0) throw new Error('Account disconnect patch failed: SettingsPage signature not found.');
  const signatureEnd = live.indexOf('\n', signatureStart);
  let signature = live.slice(signatureStart, signatureEnd);
  if (!signature.includes('onDisconnect')) {
    if (!signature.includes(', onRefresh }')) throw new Error('Account disconnect patch failed: SettingsPage onRefresh signature not found.');
    const updated = signature.replace(', onRefresh }', ', onDisconnect, onRefresh }');
    live = live.slice(0, signatureStart) + updated + live.slice(signatureEnd);
  }

  const propsStart = live.indexOf('function SettingsPage({ ');
  const propsEnd = live.indexOf('}) {', propsStart);
  if (propsEnd < 0) throw new Error('Account disconnect patch failed: SettingsPage props block not found.');
  let propsBlock = live.slice(propsStart, propsEnd);
  if (!propsBlock.includes('onDisconnect:')) {
    const refreshType = '  onRefresh: () => void;';
    if (!propsBlock.includes(refreshType)) throw new Error('Account disconnect patch failed: SettingsPage refresh type not found.');
    propsBlock = propsBlock.replace(refreshType, `  onDisconnect: (connection: LiveConnection) => void;\n${refreshType}`);
    live = live.slice(0, propsStart) + propsBlock + live.slice(propsEnd);
  }

  const connectedListStart = live.indexOf("{connections.filter((connection) => connection.status === 'connected').map((connection) => <div className=\"sc10-setting-account\"");
  if (connectedListStart < 0) throw new Error('Account disconnect patch failed: connected account row not found.');
  const connectedListEnd = live.indexOf('\n', connectedListStart);
  let connectedLine = live.slice(connectedListStart, connectedListEnd < 0 ? live.length : connectedListEnd);
  if (!connectedLine.includes('sc24-disconnect')) {
    const closing = '</div>)}';
    if (!connectedLine.includes(closing)) throw new Error('Account disconnect patch failed: connected account row closing not found.');
    connectedLine = connectedLine.replace(
      closing,
      `<button className="sc24-disconnect" onClick={() => onDisconnect(connection)} title="Déconnecter ce compte">Déconnecter</button>${closing}`,
    );
    live = live.slice(0, connectedListStart) + connectedLine + live.slice(connectedListEnd < 0 ? live.length : connectedListEnd);
  }

  live += '\n/* SC_ACCOUNT_DISCONNECT_UI_V1 */\n';
  fs.writeFileSync(livePath, live);
}

const cssPath = 'src/account-connect.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('SC_ACCOUNT_DISCONNECT_CSS_V1')) {
  css += `\n.sc10-setting-account .sc24-disconnect{background:#fff5f5;color:#b42318;border:1px solid #f2c7c3;padding:6px 9px}.sc10-setting-account .sc24-disconnect:hover{background:#ffeceb;border-color:#e9a8a2}.sc10-setting-account .sc24-disconnect:focus-visible{outline:2px solid #b42318;outline-offset:2px}\n/* SC_ACCOUNT_DISCONNECT_CSS_V1 */\n`;
  fs.writeFileSync(cssPath, css);
}

console.log('Social account disconnect/reconnect flow applied.');
