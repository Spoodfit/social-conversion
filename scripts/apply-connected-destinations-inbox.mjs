import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Connected destinations/inbox patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const eventName = 'social-conversion:connect-account';

// 1) Composer: new publications target connected accounts only.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_CONNECTED_DESTINATIONS_ONLY_V1')) {
  const conversationConnectionType = `  accountName?: string;\n  connectionId?: string;\n  status: string;`;
  if (!app.includes(conversationConnectionType)) {
    app = replaceOnce(
      app,
      `  accountName?: string;\n  status: string;`,
      conversationConnectionType,
      'stable Inbox connection id type',
    );
  }

  app = replaceOnce(
    app,
    `  function navigate(next: Page) {\n    setPage(next);\n    window.scrollTo({ top: 0, behavior: 'smooth' });\n  }`,
    `  function navigate(next: Page) {\n    setPage(next);\n    window.scrollTo({ top: 0, behavior: 'smooth' });\n  }\n\n  useEffect(() => {\n    const openConnections = () => navigate('settings');\n    window.addEventListener('${eventName}', openConnections);\n    return () => window.removeEventListener('${eventName}', openConnections);\n  }, []);`,
    'connect-account navigation event',
  );

  app = app.replaceAll(
    `const selectedCount = selectedIds.length + plannedPlatforms.length;`,
    `const selectedCount = selectedIds.length;`,
  );

  app = app.replaceAll(
    `const platformConnections = connections.filter((connection) => connection.platform === platform);`,
    `const platformConnections = connections.filter((connection) => connection.platform === platform && connection.status === 'connected');`,
  );
  app = app.replace(
    `{compatiblePlatforms.map((platform) => {`,
    `{compatiblePlatforms.filter((platform) => connections.some((connection) => connection.platform === platform && connection.status === 'connected')).map((platform) => {`,
  );
  app = app.replace(
    `                const planned = plannedPlatforms.includes(platform);\n`,
    ``,
  );
  app = app.replace(
    `                      {!platformConnections.length && <button type="button" className={planned ? 'active' : ''} onClick={() => toggleGuidedPlatform(platform)}><span><strong>Ajouter {platformLabel(platform)}</strong><small>Le compte pourra être connecté plus tard</small></span>{planned ? <Check size={16} /> : <Plus size={16} />}</button>}\n`,
    ``,
  );

  app = replaceOnce(
    app,
    `            <div className="sc9-network-list">`,
    `            {!connections.some((connection) => connection.status === 'connected' && compatiblePlatforms.includes(connection.platform as PlanningPlatform)) && (\n              <button type="button" className="sc18-connect-account" onClick={() => window.dispatchEvent(new Event('${eventName}'))}>\n                <Plus size={18} /><span><strong>Connecter un compte</strong><small>Ajoutez Instagram, YouTube ou TikTok depuis les réglages pour pouvoir publier.</small></span><ChevronRight size={17} />\n              </button>\n            )}\n            <div className="sc9-network-list">`,
    'guided empty connected-account CTA',
  );

  app += `\n// SC_CONNECTED_DESTINATIONS_ONLY_V1\n`;
  fs.writeFileSync(appPath, app);
}

// 2) Generic destination editor: remove “planifier sans compte connecté”.
const editorPath = 'src/PlatformDestinationEditor.tsx';
let editor = fs.readFileSync(editorPath, 'utf8');
if (!editor.includes('SC_CONNECTED_DESTINATION_EDITOR_V1')) {
  editor = replaceOnce(
    editor,
    `}) {\n  const selected: DestinationDraft[] = [];`,
    `}) {\n  const connectedConnections = connections.filter((connection) => connection.status === 'connected');\n  const selected: DestinationDraft[] = [];`,
    'connected connection list',
  );
  editor = editor.replace(
    `<div><strong>Où publier ?</strong><small>Un compte n’a pas besoin d’être connecté pour préparer son contenu.</small></div>`,
    `<div><strong>Où publier ?</strong><small>Sélectionnez un ou plusieurs comptes déjà connectés.</small></div>`,
  );
  editor = editor.replace(`{connections.length > 0 && (`, `{connectedConnections.length > 0 && (`);
  editor = editor.replace(`<span>Comptes connus</span>`, `<span>Comptes connectés</span>`);
  editor = editor.replace(`{connections.map((connection) => {`, `{connectedConnections.map((connection) => {`);
  editor = editor.replace(
    `<span><strong>{connection.displayName}</strong><small>{connection.handle || publicationPlatformSchemas[connection.platform].label} · {connection.status === 'connected' ? 'connecté' : 'connexion à terminer'}</small></span>`,
    `<span><strong>{connection.displayName}</strong><small>{connection.handle || publicationPlatformSchemas[connection.platform].label} · connecté</small></span>`,
  );

  const plannedStart = editor.indexOf(`      <div className="sc4-destination-group">\n        <span>Planifier sans compte connecté</span>`);
  const selectedStart = plannedStart >= 0 ? editor.indexOf(`\n\n      {selected.length > 0`, plannedStart) : -1;
  if (plannedStart < 0 || selectedStart < 0) throw new Error('Connected destinations/inbox patch failed: legacy planned destination block not found.');
  const replacement = `      {connectedConnections.length === 0 && (\n        <div className="sc18-empty-destinations">\n          <button type="button" className="sc18-connect-account" onClick={() => window.dispatchEvent(new Event('${eventName}'))}>\n            <Plus size={16} />\n            <span><strong>Connecter un compte</strong><small>Connectez d’abord un réseau social pour choisir où publier.</small></span>\n          </button>\n        </div>\n      )}`;
  editor = editor.slice(0, plannedStart) + replacement + editor.slice(selectedStart);
  editor += `\n// SC_CONNECTED_DESTINATION_EDITOR_V1\n`;
  fs.writeFileSync(editorPath, editor);
}

// 3) Inbox: synchronize recent comments from connected Instagram and YouTube accounts before listing conversations.
const workerPath = 'src/worker/index.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('SC_PROVIDER_INBOX_COMMENT_SYNC_V1')) {
  worker = replaceOnce(
    worker,
    `import { persistSocialEvent } from './persistence';`,
    `import { persistSocialEvent } from './persistence';\nimport { syncWorkspaceProviderComments } from './provider-inbox-sync';`,
    'provider inbox sync import',
  );
  worker = replaceOnce(
    worker,
    `    const principal = c.get('principal');\n    try {\n      return c.json(await listInboxConversations(c.env.DB, principal.workspaceId, {`,
    `    const principal = c.get('principal');\n    try {\n      const providerSync = await syncWorkspaceProviderComments(c.env.DB, c.env, principal.workspaceId).catch((error) => {\n        console.warn(JSON.stringify({ event: 'provider_inbox_sync_failed', workspaceId: principal.workspaceId, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));\n        return undefined;\n      });\n      const payload = await listInboxConversations(c.env.DB, principal.workspaceId, {`,
    'inbox sync before listing',
  );
  worker = replaceOnce(
    worker,
    `        stage: c.req.query('stage'),\n      }));`,
    `        stage: c.req.query('stage'),\n      });\n      return c.json({ ...payload, providerSync });`,
    'inbox sync response',
  );
  worker += `\n// SC_PROVIDER_INBOX_COMMENT_SYNC_V1\n`;
  fs.writeFileSync(workerPath, worker);
}

// 4) Visual polish: remove the accidental colored rule cutting through YouTube fields.
const cssPath = 'src/connected-destinations-inbox.css';
if (!fs.existsSync(cssPath)) {
  fs.writeFileSync(cssPath, `
.sc17-platform-card.sc17-youtube,.sc17-platform-card.sc17-instagram,.sc17-platform-card.sc17-tiktok{box-shadow:none!important}
.sc17-platform-fields .sc4-network-card,.sc17-platform-fields .sc4-field,.sc17-platform-fields .sc4-fields-grid>div{border-left:0!important;box-shadow:none}
.sc18-connect-account{width:100%;min-height:62px;padding:11px 12px;border:1px dashed #b9a9ef;border-radius:14px;background:#faf8ff;color:#14163a;display:grid;grid-template-columns:30px minmax(0,1fr) 18px;gap:9px;align-items:center;text-align:left;cursor:pointer}.sc18-connect-account:hover{border-style:solid;border-color:#8a6de4;background:#f5f1ff}.sc18-connect-account>svg:first-child{width:30px;height:30px;padding:7px;border-radius:9px;background:#eee8ff;color:#6531d7}.sc18-connect-account>span{display:grid;gap:2px;min-width:0}.sc18-connect-account strong{font-size:9px;color:#14163a}.sc18-connect-account small{font-size:7px;line-height:1.4;color:#85899c}.sc18-connect-account>svg:last-child{color:#8d82b7}
.sc18-empty-destinations{margin-top:10px}.sc9-step-networks>.sc18-connect-account{margin:2px 0 12px}
.sc17-platform-fields .sc4-field>span{padding-left:0!important}.sc17-platform-fields .sc4-field input,.sc17-platform-fields .sc4-field textarea,.sc17-platform-fields .sc4-field select{margin-left:0!important}
`);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./connected-destinations-inbox.css")) {
  main += `\nimport './connected-destinations-inbox.css';\n`;
  fs.writeFileSync(mainPath, main);
}

console.log('Connected destination picker, provider comment Inbox sync and final composer polish applied.');
