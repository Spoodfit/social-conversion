import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Provider preview/editor patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Provider history: keep a real visual preview and expose editable metadata where the API supports it.
const historyPath = 'src/worker/planner-account-history.ts';
let history = fs.readFileSync(historyPath, 'utf8');
if (!history.includes('SC_PLANNER_PROVIDER_PREVIEW_V1')) {
  history = replaceOnce(history,
`  externalUrl?: string;\n  providerStatus: ProviderStatus;`,
`  externalUrl?: string;\n  previewUrl?: string;\n  providerStatus: ProviderStatus;`,
    'remote input preview');
  history = replaceOnce(history,
`  external_url: string | null;\n  provider_status: ProviderStatus;`,
`  external_url: string | null;\n  preview_url: string | null;\n  provider_status: ProviderStatus;`,
    'remote row preview');
  history = replaceOnce(history,
`  media_type?: unknown;\n  permalink?: unknown;`,
`  media_type?: unknown;\n  media_url?: unknown;\n  thumbnail_url?: unknown;\n  permalink?: unknown;`,
    'instagram media preview fields');
  history = replaceOnce(history,
`    description?: unknown;\n    publishedAt?: unknown;`,
`    description?: unknown;\n    publishedAt?: unknown;\n    categoryId?: unknown;\n    thumbnails?: Record<string, { url?: unknown }>;`,
    'youtube thumbnail fields');

  history = replaceOnce(history,
`       (id, workspace_id, connection_id, platform, external_id, body, media_type, visibility,\n        external_url, provider_status, event_at, created_at, updated_at)\n     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
`       (id, workspace_id, connection_id, platform, external_id, body, media_type, visibility,\n        external_url, preview_url, provider_status, event_at, created_at, updated_at)\n     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'remote insert preview column');
  history = replaceOnce(history,
`       visibility = excluded.visibility,\n       external_url = excluded.external_url,\n       provider_status = excluded.provider_status,`,
`       visibility = excluded.visibility,\n       external_url = excluded.external_url,\n       preview_url = excluded.preview_url,\n       provider_status = excluded.provider_status,`,
    'remote upsert preview');
  history = replaceOnce(history,
`    post.externalUrl ?? null,\n    post.providerStatus,`,
`    post.externalUrl ?? null,\n    post.previewUrl ?? null,\n    post.providerStatus,`,
    'remote bind preview');

  history = history.replace(
    'fields=id,caption,media_type,permalink,timestamp&limit=100',
    'fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=100',
  );
  history = replaceOnce(history,
`      externalUrl: safeHttpsUrl(item.permalink),\n      providerStatus: 'published',`,
`      externalUrl: safeHttpsUrl(item.permalink),\n      previewUrl: safeHttpsUrl(item.thumbnail_url) ?? safeHttpsUrl(item.media_url),\n      providerStatus: 'published',`,
    'instagram preview mapping');

  history = replaceOnce(history,
`      const title = safeText(video.snippet?.title, 300);\n      const description = safeText(video.snippet?.description, 4_600);\n      posts.push({`,
`      const title = safeText(video.snippet?.title, 300);\n      const description = safeText(video.snippet?.description, 4_600);\n      const thumbnails = video.snippet?.thumbnails;\n      const previewUrl = safeHttpsUrl(\n        thumbnails?.maxres?.url ?? thumbnails?.standard?.url ?? thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url,\n      );\n      posts.push({`,
    'youtube preview extraction');
  history = replaceOnce(history,
`        externalUrl: \`https://www.youtube.com/watch?v=\${encodeURIComponent(externalId)}\`,\n        providerStatus: isScheduled ? 'scheduled' : 'published',`,
`        externalUrl: \`https://www.youtube.com/watch?v=\${encodeURIComponent(externalId)}\`,\n        previewUrl,\n        providerStatus: isScheduled ? 'scheduled' : 'published',`,
    'youtube preview mapping');

  history = replaceOnce(history,
`    \`SELECT rp.id, rp.connection_id, rp.platform, rp.external_id, rp.body, rp.media_type,\n            rp.visibility, rp.external_url, rp.provider_status, rp.event_at, rp.created_at, rp.updated_at,`,
`    \`SELECT rp.id, rp.connection_id, rp.platform, rp.external_id, rp.body, rp.media_type,\n            rp.visibility, rp.external_url, rp.preview_url, rp.provider_status, rp.event_at, rp.created_at, rp.updated_at,`,
    'history select preview');
  history = replaceOnce(history,
`      externalUrl: row.external_url ?? undefined,\n      providerStatus: row.provider_status,`,
`      externalUrl: row.external_url ?? undefined,\n      previewUrl: row.preview_url ?? undefined,\n      providerMediaType: row.media_type ?? undefined,\n      providerEditable: row.platform === 'youtube',\n      providerStatus: row.provider_status,`,
    'history publication preview');
  history = replaceOnce(history,
`        fields: row.visibility ? { privacyStatus: row.visibility } : {},`,
`        fields: row.platform === 'youtube'\n          ? (() => {\n              const [title = '', ...descriptionParts] = row.body.split('\\n\\n');\n              return { title, description: descriptionParts.join('\\n\\n'), ...(row.visibility ? { privacyStatus: row.visibility } : {}) };\n            })()\n          : { caption: row.body },`,
    'provider fields hydration');

  history += `\n\nexport class PlannerProviderEditError extends Error {\n  readonly code: 'REMOTE_POST_NOT_FOUND' | 'REMOTE_EDIT_UNSUPPORTED' | 'REMOTE_EDIT_SCOPE_MISSING' | 'REMOTE_EDIT_INVALID' | 'REMOTE_EDIT_PROVIDER_FAILED';\n  constructor(code: PlannerProviderEditError['code'], message: string) { super(message); this.name = 'PlannerProviderEditError'; this.code = code; }\n}\n\nasync function providerPutJson(fetchImpl: typeof fetch, url: string, accessToken: string, body: unknown): Promise<unknown> {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), 15_000);\n  try {\n    const response = await fetchImpl(url, {\n      method: 'PUT',\n      headers: { authorization: \`Bearer \${accessToken}\`, 'content-type': 'application/json' },\n      body: JSON.stringify(body),\n      signal: controller.signal,\n    });\n    if (!response.ok) throw new PlannerProviderEditError('REMOTE_EDIT_PROVIDER_FAILED', \`YouTube refused the update (HTTP \${response.status}).\`);\n    return await response.json();\n  } finally { clearTimeout(timeout); }\n}\n\nfunction youtubeBodyParts(body: string) {\n  const normalized = body.trim();\n  if (!normalized) throw new PlannerProviderEditError('REMOTE_EDIT_INVALID', 'Le titre YouTube ne peut pas être vide.');\n  const [first = '', ...rest] = normalized.split(/\\n+/);\n  const title = first.trim().slice(0, 100);\n  if (!title) throw new PlannerProviderEditError('REMOTE_EDIT_INVALID', 'Le titre YouTube ne peut pas être vide.');\n  return { title, description: rest.join('\\n').trim().slice(0, 5_000) };\n}\n\nexport async function updateRemotePlannerPublication(\n  db: D1Database, env: Env, workspaceId: string, remoteId: string, body: string, fetchImpl: typeof fetch = fetch,\n) {\n  const id = remoteId.startsWith('provider:') ? remoteId.slice('provider:'.length) : remoteId;\n  const row = await db.prepare(\n    \`SELECT rp.id, rp.connection_id, rp.platform, rp.external_id, rp.body, sc.status AS connection_status\n     FROM planner_remote_posts rp\n     JOIN social_connections sc ON sc.id = rp.connection_id AND sc.workspace_id = rp.workspace_id\n     WHERE rp.id = ? AND rp.workspace_id = ? LIMIT 1\`,\n  ).bind(id, workspaceId).first<{ id: string; connection_id: string; platform: PlannerPlatform; external_id: string; body: string; connection_status: string }>();\n  if (!row || row.connection_status !== 'connected') throw new PlannerProviderEditError('REMOTE_POST_NOT_FOUND', 'Publication synchronisée introuvable.');\n  if (row.platform !== 'youtube') {\n    throw new PlannerProviderEditError('REMOTE_EDIT_UNSUPPORTED', 'Instagram ne permet pas de modifier via API la légende d’une publication déjà publiée.');\n  }\n  const keyring = tokenKeyringSecret(env);\n  if (!keyring) throw new PlannerProviderEditError('REMOTE_EDIT_SCOPE_MISSING', 'Configuration YouTube incomplète.');\n  const tokens = await loadOAuthTokens(db, keyring, workspaceId, row.connection_id);\n  if (!tokens || tokens.credentials.provider !== 'youtube' || !tokens.credentials.scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl')) {\n    throw new PlannerProviderEditError('REMOTE_EDIT_SCOPE_MISSING', 'Reconnectez YouTube pour autoriser la modification des métadonnées.');\n  }\n  const currentUrl = new URL('https://www.googleapis.com/youtube/v3/videos');\n  currentUrl.searchParams.set('part', 'snippet');\n  currentUrl.searchParams.set('id', row.external_id);\n  const current = await providerJson(fetchImpl, currentUrl.toString(), tokens.accessToken) as { items?: Array<{ snippet?: { categoryId?: unknown; tags?: unknown; defaultLanguage?: unknown; defaultAudioLanguage?: unknown } }> };\n  const snippet = current.items?.[0]?.snippet;\n  const categoryId = safeText(snippet?.categoryId, 40);\n  if (!categoryId) throw new PlannerProviderEditError('REMOTE_EDIT_PROVIDER_FAILED', 'Catégorie YouTube introuvable pour cette vidéo.');\n  const next = youtubeBodyParts(body);\n  const nextSnippet: Record<string, unknown> = { title: next.title, description: next.description, categoryId };\n  if (Array.isArray(snippet?.tags)) nextSnippet.tags = snippet?.tags;\n  const defaultLanguage = safeText(snippet?.defaultLanguage, 30);\n  const defaultAudioLanguage = safeText(snippet?.defaultAudioLanguage, 30);\n  if (defaultLanguage) nextSnippet.defaultLanguage = defaultLanguage;\n  if (defaultAudioLanguage) nextSnippet.defaultAudioLanguage = defaultAudioLanguage;\n  const updateUrl = new URL('https://www.googleapis.com/youtube/v3/videos');\n  updateUrl.searchParams.set('part', 'snippet');\n  await providerPutJson(fetchImpl, updateUrl.toString(), tokens.accessToken, { id: row.external_id, snippet: nextSnippet });\n  await db.prepare('UPDATE planner_remote_posts SET body = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')\n    .bind([next.title, next.description].filter(Boolean).join('\\n\\n'), new Date().toISOString(), id, workspaceId).run();\n  const publications = await listRemotePlannerPublications(db, workspaceId);\n  const updated = publications.find((publication) => publication.id === \`provider:\${id}\`);\n  if (!updated) throw new PlannerProviderEditError('REMOTE_POST_NOT_FOUND', 'Publication synchronisée introuvable après modification.');\n  return updated;\n}\n\n// SC_PLANNER_PROVIDER_PREVIEW_V1\n`;
  fs.writeFileSync(historyPath, history);
}

// 2) API route + CSP for trusted provider thumbnails.
const workerPath = 'src/worker/index.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('SC_PLANNER_PROVIDER_EDITOR_API_V1')) {
  worker = replaceOnce(worker,
    `import { listRemotePlannerPublications, syncWorkspacePlannerHistory } from './planner-account-history';`,
    `import { listRemotePlannerPublications, PlannerProviderEditError, syncWorkspacePlannerHistory, updateRemotePlannerPublication } from './planner-account-history';`,
    'worker provider editor import');
  worker = replaceOnce(worker,
    `      imgSrc: ["'self'", 'data:'],`,
    `      imgSrc: ["'self'", 'data:', 'https://*.cdninstagram.com', 'https://*.fbcdn.net', 'https://i.ytimg.com'],`,
    'provider preview CSP');
  worker = replaceOnce(worker,
`  app.get('/api/planner/history', async (c) => {\n    if (!liveDataReady(c.env)) {\n      return c.json({ error: 'Live Planner history is locked.', code: 'LIVE_NOT_READY' }, 503);\n    }\n    const principal = c.get('principal');\n    const sync = await syncWorkspacePlannerHistory(c.env.DB, c.env, principal.workspaceId);\n    const publications = await listRemotePlannerPublications(c.env.DB, principal.workspaceId);\n    return c.json({ publications, sync });\n  });`,
`  app.get('/api/planner/history', async (c) => {\n    if (!liveDataReady(c.env)) {\n      return c.json({ error: 'Live Planner history is locked.', code: 'LIVE_NOT_READY' }, 503);\n    }\n    const principal = c.get('principal');\n    const sync = await syncWorkspacePlannerHistory(c.env.DB, c.env, principal.workspaceId);\n    const publications = await listRemotePlannerPublications(c.env.DB, principal.workspaceId);\n    return c.json({ publications, sync });\n  });\n\n  app.put('/api/planner/history/:id', async (c) => {\n    if (!liveDataReady(c.env)) return c.json({ error: 'Live Planner history is locked.', code: 'LIVE_NOT_READY' }, 503);\n    const principal = c.get('principal');\n    if (!roleCanMutate(principal.role)) return c.json({ error: 'Mutation forbidden for this role.', code: 'ROLE_FORBIDDEN' }, 403);\n    const payload = await c.req.json<{ body?: unknown }>().catch(() => ({}));\n    if (typeof payload.body !== 'string' || !payload.body.trim()) return c.json({ error: 'Contenu invalide.', code: 'REMOTE_EDIT_INVALID' }, 400);\n    try {\n      const publication = await updateRemotePlannerPublication(c.env.DB, c.env, principal.workspaceId, c.req.param('id'), payload.body);\n      return c.json({ publication });\n    } catch (error) {\n      if (error instanceof PlannerProviderEditError) {\n        const status = error.code === 'REMOTE_POST_NOT_FOUND' ? 404 : error.code === 'REMOTE_EDIT_SCOPE_MISSING' ? 409 : error.code === 'REMOTE_EDIT_PROVIDER_FAILED' ? 502 : 400;\n        return c.json({ error: error.message, code: error.code }, status);\n      }\n      throw error;\n    }\n  });`,
    'provider editor route');
  worker += '\n// SC_PLANNER_PROVIDER_EDITOR_API_V1\n';
  fs.writeFileSync(workerPath, worker);
}

// 3) Planner UI: actual thumbnails in month/week/list + same drawer for synchronized content.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_PLANNER_PROVIDER_EDITOR_UI_V1')) {
  app = replaceOnce(app,
`  providerStatus?: 'published' | 'scheduled';\n};`,
`  providerStatus?: 'published' | 'scheduled';\n  previewUrl?: string;\n  providerMediaType?: string;\n  providerEditable?: boolean;\n};`,
    'publication provider preview type');
  app = replaceOnce(app,
`function mediaIdFromReference(value?: string) {\n  return value?.startsWith('library:') ? value.slice('library:'.length) : undefined;\n}\n`,
`function mediaIdFromReference(value?: string) {\n  return value?.startsWith('library:') ? value.slice('library:'.length) : undefined;\n}\n\nfunction providerPreviewMedia(publication?: Publication): MediaItem | undefined {\n  if (!publication?.readOnly || !publication.previewUrl) return undefined;\n  const target = publication.targets[0];\n  const format: MediaFormat = target?.platform === 'youtube' ? 'video' : target?.format === 'story' ? 'story' : target?.format === 'reel' || target?.format === 'short' || publication.providerMediaType === 'VIDEO' ? 'short' : 'post';\n  return {\n    id: \`remote-preview:\${publication.id}\`,\n    fileName: publication.id,\n    mimeType: 'image/jpeg',\n    format,\n    title: publication.body.split('\\n')[0]?.slice(0, 120) || 'Publication synchronisée',\n    caption: publication.body,\n    sizeBytes: 0,\n    createdAt: publication.createdAt,\n    updatedAt: publication.updatedAt,\n    previewUrl: publication.previewUrl,\n  };\n}\n`,
    'provider preview media helper');

  app = replaceOnce(app,
`    if (publication.readOnly) {\n      if (publication.externalUrl) {\n        window.open(publication.externalUrl, '_blank', 'noopener,noreferrer');\n      } else {\n        setToast(publication.providerStatus === 'scheduled'\n          ? 'Cette publication est programmée sur le réseau d’origine.'\n          : 'Cette publication provient du compte social connecté.');\n      }\n      return;\n    }\n`,
`    // Les contenus synchronisés s’ouvrent eux aussi dans le même volet d’édition.\n`,
    'open synchronized post in drawer');

  app = app.replace(
    `              selectedMedia={selectedMedia}`,
    `              selectedMedia={editingPublication?.readOnly ? providerPreviewMedia(editingPublication) ?? selectedMedia : selectedMedia}`,
  );

  app = replaceOnce(app,
`      if (editingPublication) {\n        const result = await apiRequest<{ publication: Publication }>(\`/api/publications/\${encodeURIComponent(editingPublication.id)}\`, {`,
`      if (editingPublication?.source === 'provider') {\n        if (!editingPublication.providerEditable) {\n          setToast('Instagram ne permet pas de modifier via API une publication déjà publiée. Son aperçu reste accessible ici.');\n          return;\n        }\n        const providerDestination = destinations[0];\n        const fields = providerDestination?.fields ?? {};\n        const providerBody = editingPublication.targets[0]?.platform === 'youtube'\n          ? [typeof fields.title === 'string' ? fields.title.trim() : '', typeof fields.description === 'string' ? fields.description.trim() : ''].filter(Boolean).join('\\n\\n')\n          : typeof fields.caption === 'string' ? fields.caption.trim() : body;\n        const result = await apiRequest<{ publication: Publication }>(\`/api/planner/history/\${encodeURIComponent(editingPublication.id)}\`, {\n          method: 'PUT',\n          body: JSON.stringify({ body: providerBody || body }),\n        }, workspaceId);\n        setPublications((current) => current.map((candidate) => candidate.id === editingPublication.id ? result.publication : candidate));\n        resetComposer();\n        navigate('planner');\n        setToast('Métadonnées mises à jour sur YouTube.');\n      } else if (editingPublication) {\n        const result = await apiRequest<{ publication: Publication }>(\`/api/publications/\${encodeURIComponent(editingPublication.id)}\`, {`,
    'provider save branch');

  app = app.replace(
    `disabled={busy || (!selectedIds.length && !plannedPlatforms.length)} onClick={onSchedule}>{busy ? 'Enregistrement…' : editingPublication ? 'Enregistrer les modifications'`,
    `disabled={busy || (!selectedIds.length && !plannedPlatforms.length) || Boolean(editingPublication?.readOnly && !editingPublication.providerEditable)} onClick={onSchedule}>{busy ? 'Enregistrement…' : editingPublication?.readOnly ? (editingPublication.providerEditable ? 'Enregistrer sur YouTube' : 'Modification indisponible via Instagram') : editingPublication ? 'Enregistrer les modifications'`,
  );
  app = app.replace(
    `{editingPublication && <button className="sc3-cancel-publication" disabled={busy} onClick={onCancel}><Trash2 size={14} /> Annuler cette publication</button>}`,
    `{editingPublication && !editingPublication.readOnly && <button className="sc3-cancel-publication" disabled={busy} onClick={onCancel}><Trash2 size={14} /> Annuler cette publication</button>}\n          {editingPublication?.readOnly && editingPublication.externalUrl && <button type="button" className="sc16-provider-link" onClick={() => window.open(editingPublication.externalUrl, '_blank', 'noopener,noreferrer')}><Eye size={14} /> Ouvrir sur {platformLabel(editingPublication.targets[0]?.platform ?? 'instagram')}</button>}\n          {editingPublication?.readOnly && !editingPublication.providerEditable && <small className="sc16-provider-limit"><AlertTriangle size={13} /> Aperçu et contenu synchronisés. Meta ne permet pas de modifier via API une publication Instagram déjà publiée.</small>}`,
  );

  // Week cards and collision stacks: provider image instead of a generic network icon.
  app = app.replaceAll(
    `{media?.mimeType.startsWith('image/') && <img src={media.previewUrl} alt="" />}`,
    `{(publication.previewUrl || media?.mimeType.startsWith('image/')) && <img src={publication.previewUrl ?? media!.previewUrl} alt="" />}`,
  );
  app = app.replaceAll(
    `{media?.mimeType.startsWith('image/') ? <img src={media.previewUrl} alt="" /> : media ? <Video size={14} /> : <MessageCircle size={14} />}`,
    `{item.previewUrl ? <img src={item.previewUrl} alt="" /> : media?.mimeType.startsWith('image/') ? <img src={media.previewUrl} alt="" /> : media ? <Video size={14} /> : <MessageCircle size={14} />}`,
  );

  // Month: visual first. Remote provider preview wins, local library preview remains the fallback.
  app = replaceOnce(app,
`                        const media = library.get(mediaIdFromReference(publication.mediaReference) ?? '');\n                        return (`,
`                        const media = library.get(mediaIdFromReference(publication.mediaReference) ?? '');\n                        const visualPreviewUrl = publication.previewUrl ?? (media?.mimeType.startsWith('image/') ? media.previewUrl : undefined);\n                        return (`,
    'month visual preview variable');
  app = replaceOnce(app,
`                              {media?.mimeType.startsWith('image/')\n                                ? <img src={media.previewUrl} alt="" />\n                                : <span>{publication.targets.slice(0, 1).map((target) => <PlatformMark key={target.id} platform={target.platform} size={12} />)}</span>}`,
`                              {visualPreviewUrl\n                                ? <img src={visualPreviewUrl} alt="" />\n                                : <span>{publication.targets.slice(0, 1).map((target) => <PlatformMark key={target.id} platform={target.platform} size={12} />)}</span>}`,
    'month visual preview render');

  // List view also gets the synchronized thumbnail.
  app = app.replace(
    `{media?.mimeType.startsWith('image/') ? <img src={media.previewUrl} alt="" /> : media ? <Video size={17} /> : <MessageCircle size={17} />}`,
    `{publication.previewUrl ? <img src={publication.previewUrl} alt="" /> : media?.mimeType.startsWith('image/') ? <img src={media.previewUrl} alt="" /> : media ? <Video size={17} /> : <MessageCircle size={17} />}`,
  );

  app += '\n/* SC_PLANNER_PROVIDER_EDITOR_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./planner-provider-preview-editor.css")) {
  main += "\nimport './planner-provider-preview-editor.css';\n";
  fs.writeFileSync(mainPath, main);
}

console.log('Provider thumbnails and synchronized publication drawer applied.');
