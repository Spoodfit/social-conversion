import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Inbox polish v2 failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Facebook: keep provider identity when available and persist best-effort avatars.
const facebookPath = 'src/worker/facebook-runtime-sync.ts';
let facebook = fs.readFileSync(facebookPath, 'utf8');
if (!facebook.includes('SC_INBOX_IDENTITY_V2')) {
  facebook = replaceOnce(
    facebook,
    `    contactName: string;\n    externalMessageId: string;`,
    `    contactName: string;\n    contactAvatarUrl?: string;\n    externalMessageId: string;`,
    'Facebook contact avatar input',
  );

  facebook = replaceOnce(
    facebook,
    `      \`INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, created_at, updated_at)\n       VALUES (?, ?, ?, 'facebook', ?, ?, ?)\n       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at\`,\n    ).bind(contactId, input.workspaceId, input.externalContactId, input.contactName, input.occurredAt, now),`,
    `      \`INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, metadata_json, created_at, updated_at)\n       VALUES (?, ?, ?, 'facebook', ?, ?, ?, ?)\n       ON CONFLICT(id) DO UPDATE SET\n         display_name = CASE WHEN excluded.display_name NOT LIKE 'Utilisateur Facebook%' THEN excluded.display_name ELSE contacts.display_name END,\n         metadata_json = CASE WHEN excluded.metadata_json <> '{}' THEN excluded.metadata_json ELSE contacts.metadata_json END,\n         updated_at = excluded.updated_at\`,\n    ).bind(\n      contactId,\n      input.workspaceId,\n      input.externalContactId,\n      input.contactName,\n      input.contactAvatarUrl ? JSON.stringify({ avatarUrl: input.contactAvatarUrl }) : '{}',\n      input.occurredAt,\n      now,\n    ),`,
    'Facebook contact metadata persistence',
  );

  const helperAnchor = `async function syncComments(\n  db: D1Database,`;
  if (!facebook.includes(helperAnchor)) throw new Error('Inbox polish v2 failed: Facebook comment sync anchor not found.');
  const avatarHelper = `async function facebookProfilePicture(\n  env: Env,\n  externalId: string,\n  token: string,\n  fetchImpl: typeof fetch,\n): Promise<string | undefined> {\n  if (!externalId) return undefined;\n  try {\n    const url = new URL(\`https://graph.facebook.com/\${graphVersion(env)}/\${encodeURIComponent(externalId)}/picture\`);\n    url.searchParams.set('redirect', 'false');\n    url.searchParams.set('type', 'square');\n    const payload = await graphGet<{ data?: { url?: unknown } }>(fetchImpl, url.toString(), token);\n    return safeHttps(payload.data?.url);\n  } catch {\n    return undefined;\n  }\n}\n\n`;
  facebook = facebook.replace(helperAnchor, avatarHelper + helperAnchor);

  facebook = replaceOnce(
    facebook,
    `  let saved = 0;\n  let attemptedPosts = 0;\n  let failedPosts = 0;\n  let lastError: unknown;`,
    `  let saved = 0;\n  let attemptedPosts = 0;\n  let failedPosts = 0;\n  let lastError: unknown;\n  const avatarCache = new Map<string, string | undefined>();`,
    'Facebook comment avatar cache',
  );

  facebook = replaceOnce(
    facebook,
    `      comments = await fetchFacebookCommentPages(\n        env, postId, token, fetchImpl, 'id,message,created_time,from{id,name},parent{id,from{id,name}}',\n      );\n    } catch (error) {\n      try {\n        comments = await fetchFacebookCommentPages(env, postId, token, fetchImpl, 'id,message,created_time,parent{id}');\n      } catch (fallbackError) {`,
    `      comments = await fetchFacebookCommentPages(\n        env, postId, token, fetchImpl, 'id,message,created_time,from{id,name},parent{id}',\n      );\n    } catch (error) {\n      try {\n        comments = await fetchFacebookCommentPages(env, postId, token, fetchImpl, 'id,message,created_time,from{id,name}');\n      } catch {\n        try {\n          comments = await fetchFacebookCommentPages(env, postId, token, fetchImpl, 'id,message,created_time,parent{id}');\n        } catch (fallbackError) {`,
    'Facebook identity-preserving comment fallback',
  );

  facebook = replaceOnce(
    facebook,
    `        lastError = fallbackError instanceof Error ? fallbackError : error;\n        continue;\n      }\n    }\n\n    comments.sort`,
    `          lastError = fallbackError instanceof Error ? fallbackError : error;\n          continue;\n        }\n      }\n    }\n\n    comments.sort`,
    'Facebook nested fallback braces',
  );

  facebook = replaceOnce(
    facebook,
    `      const parentContact = parentId ? await storedCommentContact(db, connection, parentId) : undefined;\n      const outbound = authorId === connection.external_account_id;`,
    `      const parentContact = parentId ? await storedCommentContact(db, connection, parentId) : undefined;\n      const outbound = authorId === connection.external_account_id;\n      let authorAvatarUrl: string | undefined;\n      if (!outbound && authorId) {\n        if (avatarCache.has(authorId)) authorAvatarUrl = avatarCache.get(authorId);\n        else {\n          authorAvatarUrl = await facebookProfilePicture(env, authorId, token, fetchImpl);\n          avatarCache.set(authorId, authorAvatarUrl);\n        }\n      }`,
    'Facebook comment avatar lookup',
  );

  facebook = replaceOnce(
    facebook,
    `        contactName,\n        externalMessageId: id,`,
    `        contactName,\n        contactAvatarUrl: authorAvatarUrl,\n        externalMessageId: id,`,
    'Facebook comment avatar persistence',
  );

  facebook = replaceOnce(
    facebook,
    `    if (!participantId) continue;\n\n    for (const message of messages) {`,
    `    if (!participantId) continue;\n    const participantAvatarUrl = await facebookProfilePicture(env, participantId, token, fetchImpl);\n\n    for (const message of messages) {`,
    'Messenger participant avatar lookup',
  );

  facebook = replaceOnce(
    facebook,
    `        contactName: participantName || \`Contact Facebook \${participantId.slice(-4)}\`,\n        externalMessageId: id,`,
    `        contactName: participantName || \`Contact Facebook \${participantId.slice(-4)}\`,\n        contactAvatarUrl: participantAvatarUrl,\n        externalMessageId: id,`,
    'Messenger participant avatar persistence',
  );

  facebook += '\n// SC_INBOX_IDENTITY_V2\n';
  fs.writeFileSync(facebookPath, facebook);
}

// Inbox API: expose the avatar URL already stored in contact metadata.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_INBOX_AVATAR_V2')) {
  liveData = replaceOnce(
    liveData,
    `  contact_name: string;\n  handle: string | null;`,
    `  contact_name: string;\n  contact_metadata_json: string;\n  handle: string | null;`,
    'Inbox contact metadata row',
  );

  liveData = replaceOnce(
    liveData,
    `       ct.display_name AS contact_name,\n       ct.handle,`,
    `       ct.display_name AS contact_name,\n       ct.metadata_json AS contact_metadata_json,\n       ct.handle,`,
    'Inbox contact metadata select',
  );

  liveData = replaceOnce(
    liveData,
    `export async function listInboxConversations(`,
    `function contactAvatarUrl(raw: string): string | undefined {\n  try {\n    const parsed = JSON.parse(raw) as { avatarUrl?: unknown };\n    if (typeof parsed.avatarUrl !== 'string') return undefined;\n    const url = new URL(parsed.avatarUrl);\n    return url.protocol === 'https:' ? url.toString() : undefined;\n  } catch {\n    return undefined;\n  }\n}\n\nexport async function listInboxConversations(`,
    'Inbox avatar parser',
  );

  liveData = replaceOnce(
    liveData,
    `      contactName: row.contact_name,\n      handle: row.handle ?? undefined,`,
    `      contactName: row.contact_name,\n      avatarUrl: contactAvatarUrl(row.contact_metadata_json),\n      handle: row.handle ?? undefined,`,
    'Inbox avatar response',
  );

  liveData += '\n// SC_INBOX_AVATAR_V2\n';
  fs.writeFileSync(liveDataPath, liveData);
}

// UI: real avatars, preserved line breaks, collapsible left navigation.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_INBOX_POLISH_UI_V2')) {
  app = replaceOnce(
    app,
    `  contactName: string;\n  handle?: string;`,
    `  contactName: string;\n  avatarUrl?: string;\n  handle?: string;`,
    'Inbox avatar UI type',
  );

  app = replaceOnce(
    app,
    `function localDateKey(date: Date) {`,
    `function ContactAvatar({ name, url }: { name: string; url?: string }) {\n  const initials = name.trim().split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';\n  return <span className="sc3-avatar sc24-contact-avatar"><span>{initials}</span>{url && <img src={url} alt="" referrerPolicy="no-referrer" onError={(event) => event.currentTarget.remove()} />}</span>;\n}\n\nfunction localDateKey(date: Date) {`,
    'ContactAvatar component',
  );

  app = replaceOnce(
    app,
    `  const [accountPanelOpen, setAccountPanelOpen] = useState(false);\n  const [toast, setToast] = useState('');`,
    `  const [accountPanelOpen, setAccountPanelOpen] = useState(false);\n  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('social-conversion.sidebar-collapsed') === '1');\n  const [toast, setToast] = useState('');`,
    'sidebar collapsed state',
  );

  app = replaceOnce(
    app,
    `    <div className={\`sc3-shell\${page === 'create' ? ' sc6-drawer-open' : ''}\`}>`,
    `    <div className={\`sc3-shell\${page === 'create' ? ' sc6-drawer-open' : ''}\${sidebarCollapsed ? ' sidebar-collapsed' : ''}\`}>`,
    'sidebar shell class',
  );

  app = replaceOnce(
    app,
    `      <aside className="sc3-sidebar">\n        <button className="sc3-brand" onClick={() => navigate('planner')}>`,
    `      <aside className="sc3-sidebar">\n        <button\n          className="sc24-sidebar-toggle"\n          type="button"\n          title={sidebarCollapsed ? 'Déployer le menu' : 'Réduire le menu'}\n          aria-label={sidebarCollapsed ? 'Déployer le menu principal' : 'Réduire le menu principal'}\n          onClick={() => setSidebarCollapsed((current) => {\n            const next = !current;\n            window.localStorage.setItem('social-conversion.sidebar-collapsed', next ? '1' : '0');\n            return next;\n          })}\n        >{sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}</button>\n        <button className="sc3-brand" onClick={() => navigate('planner')}>`,
    'sidebar collapse button',
  );

  app = app.replaceAll(
    `<span className="sc3-avatar">{conversation.contactName.slice(0, 2).toUpperCase()}</span>`,
    `<ContactAvatar name={conversation.contactName} url={conversation.avatarUrl} />`,
  );
  app = app.replaceAll(
    `<span className="sc3-avatar">{selected.contactName.slice(0, 2).toUpperCase()}</span>`,
    `<ContactAvatar name={selected.contactName} url={selected.avatarUrl} />`,
  );

  app += '\n/* SC_INBOX_POLISH_UI_V2 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('Inbox polish v2 applied: preserved formatting, Facebook identity/avatar enrichment, spacing and collapsible sidebar.');
