import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`YouTube lifecycle v2 patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Platform schema: explicit audience choice and useful YouTube publish controls.
const fieldsPath = 'src/shared/social-publication-fields.ts';
let fields = fs.readFileSync(fieldsPath, 'utf8');
if (!fields.includes('SC_YOUTUBE_LIFECYCLE_FIELDS_V2')) {
  fields = fields.replace(
    `export type PublicationFieldKind = 'text' | 'textarea' | 'select' | 'toggle' | 'tags' | 'number';`,
    `export type PublicationFieldKind = 'text' | 'textarea' | 'select' | 'toggle' | 'boolean-choice' | 'tags' | 'number';`,
  );
  fields = fields.replaceAll(
    `{ key: 'madeForKids', label: 'Contenu destiné aux enfants', kind: 'toggle' },`,
    `{ key: 'madeForKids', label: 'Cette vidéo est-elle conçue pour les enfants ?', kind: 'boolean-choice', requiredToPlan: true, help: 'YouTube exige une réponse explicite avant publication.' },`,
  );
  fields = fields.replace(
    `{ key: 'embeddable', label: 'Autoriser l’intégration sur d’autres sites', kind: 'toggle' },`,
    `{ key: 'embeddable', label: 'Autoriser l’intégration sur d’autres sites', kind: 'toggle' },\n          { key: 'notifySubscribers', label: 'Notifier les abonnés', kind: 'toggle', help: 'YouTube enverra les notifications habituelles lors de la publication.' },`,
  );
  fields = fields.replace(
    `  for (const field of resolved.fields) {\n    if (field.kind === 'toggle') result[field.key] = false;`,
    `  for (const field of resolved.fields) {\n    if (field.kind === 'toggle') result[field.key] = false;`,
  );
  fields = fields.replace(
    `  if (platform === 'youtube') result.embeddable = true;`,
    `  if (platform === 'youtube') {\n    result.embeddable = true;\n    result.notifySubscribers = true;\n  }`,
  );
  fields = fields.replace(
    `    if (field.kind === 'toggle') {\n      if (typeof value === 'boolean') normalized[field.key] = value;\n      continue;\n    }`,
    `    if (field.kind === 'toggle' || field.kind === 'boolean-choice') {\n      if (typeof value === 'boolean') normalized[field.key] = value;\n      continue;\n    }`,
  );
  fields += `\n// SC_YOUTUBE_LIFECYCLE_FIELDS_V2\n`;
  fs.writeFileSync(fieldsPath, fields);
}

// 2) Platform editor: render an explicit Oui/Non audience choice with no default answer.
const editorPath = 'src/PlatformDestinationEditor.tsx';
let editor = fs.readFileSync(editorPath, 'utf8');
if (!editor.includes('sc16-boolean-choice')) {
  editor = replaceOnce(editor,
`  if (definition.kind === 'toggle') {\n    return (\n      <label className="sc4-toggle" htmlFor={id}>\n        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />\n        <span><strong>{definition.label}</strong>{definition.help && <small>{definition.help}</small>}</span>\n      </label>\n    );\n  }`,
`  if (definition.kind === 'toggle') {\n    return (\n      <label className="sc4-toggle" htmlFor={id}>\n        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />\n        <span><strong>{definition.label}</strong>{definition.help && <small>{definition.help}</small>}</span>\n      </label>\n    );\n  }\n  if (definition.kind === 'boolean-choice') {\n    const selected = typeof value === 'boolean' ? value : undefined;\n    return (\n      <fieldset className="sc16-boolean-choice">\n        <legend>{definition.label}{definition.requiredToPlan && <b>Requis</b>}</legend>\n        <div>\n          <button type="button" className={selected === true ? 'active' : ''} onClick={() => onChange(true)}><span>Oui</span><small>Elle est conçue pour les enfants</small>{selected === true && <Check size={14} />}</button>\n          <button type="button" className={selected === false ? 'active' : ''} onClick={() => onChange(false)}><span>Non</span><small>Elle n’est pas conçue pour les enfants</small>{selected === false && <Check size={14} />}</button>\n        </div>\n        {definition.help && <small>{definition.help}</small>}\n      </fieldset>\n    );\n  }`,
    'boolean choice editor');
  fs.writeFileSync(editorPath, editor);
}

// 3) Destination validation can be relaxed for drafts, while scheduled content remains strict.
const destinationsPath = 'src/worker/publishing-destinations.ts';
let destinations = fs.readFileSync(destinationsPath, 'utf8');
if (!destinations.includes('allowIncomplete?: boolean')) {
  destinations = replaceOnce(destinations,
`export async function resolvePublicationDestinations(\n  db: D1Database,\n  workspaceId: string,\n  rawDestinations: unknown,\n  legacyConnectionIds?: unknown,\n): Promise<ResolvedPublicationDestination[]> {`,
`export async function resolvePublicationDestinations(\n  db: D1Database,\n  workspaceId: string,\n  rawDestinations: unknown,\n  legacyConnectionIds?: unknown,\n  options: { allowIncomplete?: boolean } = {},\n): Promise<ResolvedPublicationDestination[]> {`,
    'destination options');
  destinations = replaceOnce(destinations,
`    const missing = missingRequiredPlanningFields(platform, format, fields);\n    if (missing.length) {`,
`    const missing = missingRequiredPlanningFields(platform, format, fields);\n    if (missing.length && !options.allowIncomplete) {`,
    'draft validation relaxation');
  fs.writeFileSync(destinationsPath, destinations);
}

// 4) Publication persistence: draft is a real first-class status.
const publishingPath = 'src/worker/publishing.ts';
let publishing = fs.readFileSync(publishingPath, 'utf8');
if (!publishing.includes('normalizePublicationLifecycleStatus')) {
  publishing = replaceOnce(publishing,
`export interface CreatePublicationInput {\n  body?: unknown;`,
`export interface CreatePublicationInput {\n  status?: unknown;\n  body?: unknown;`,
    'create status input');
  publishing = replaceOnce(publishing,
`export function normalizePublicationDate(value: unknown) {`,
`export function normalizePublicationLifecycleStatus(value: unknown, fallback: 'draft' | 'scheduled' = 'scheduled'): 'draft' | 'scheduled' {\n  if (value === undefined || value === null || value === '') return fallback;\n  if (value === 'draft' || value === 'scheduled') return value;\n  throw new PublishingError('INVALID_PUBLICATION', 'Le statut de publication est invalide.');\n}\n\nexport function normalizePublicationDate(value: unknown) {`,
    'lifecycle normalizer');
  publishing = replaceOnce(publishing,
`export async function resolveDestinationsOrPublishingError(\n  db: D1Database,\n  workspaceId: string,\n  destinations: unknown,\n  connectionIds?: unknown,\n) {\n  try {\n    return await resolvePublicationDestinations(db, workspaceId, destinations, connectionIds);`,
`export async function resolveDestinationsOrPublishingError(\n  db: D1Database,\n  workspaceId: string,\n  destinations: unknown,\n  connectionIds?: unknown,\n  options: { allowIncomplete?: boolean } = {},\n) {\n  try {\n    return await resolvePublicationDestinations(db, workspaceId, destinations, connectionIds, options);`,
    'destination wrapper options');
  publishing = replaceOnce(publishing,
`  const destinations = await resolveDestinationsOrPublishingError(\n    db,\n    principal.workspaceId,\n    rawInput.destinations,\n    rawInput.connectionIds,\n  );`,
`  const status = normalizePublicationLifecycleStatus(rawInput.status);\n  const destinations = await resolveDestinationsOrPublishingError(\n    db,\n    principal.workspaceId,\n    rawInput.destinations,\n    rawInput.connectionIds,\n    { allowIncomplete: status === 'draft' },\n  );`,
    'create draft destinations');
  publishing = replaceOnce(publishing,
`       id, workspace_id, body, media_reference, status, scheduled_at, created_by, version, created_at, updated_at\n       ) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, 1, ?, ?)`,
`       id, workspace_id, body, media_reference, status, scheduled_at, created_by, version, created_at, updated_at\n       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    'create dynamic status SQL');
  publishing = replaceOnce(publishing,
`      mediaReference ?? null,\n      scheduledAt,\n      principal.subject,`,
`      mediaReference ?? null,\n      status,\n      scheduledAt,\n      principal.subject,`,
    'create status bind');
  publishing = replaceOnce(publishing,
`    ...destinationInsertStatements(db, principal.workspaceId, id, destinations, now),\n    ...connectedLegacyTargetStatements(db, principal.workspaceId, id, destinations, now),`,
`    ...destinationInsertStatements(db, principal.workspaceId, id, destinations, now),\n    ...(status === 'scheduled' ? connectedLegacyTargetStatements(db, principal.workspaceId, id, destinations, now) : []),`,
    'draft targets');
  fs.writeFileSync(publishingPath, publishing);
}

// 5) Publication update: keep drafts editable and promote them to scheduled only when valid.
const updatePath = 'src/worker/publishing-update.ts';
let update = fs.readFileSync(updatePath, 'utf8');
if (!update.includes('normalizePublicationLifecycleStatus')) {
  update = update.replace(
    `  normalizeMediaReference,\n  normalizePublicationBody,`,
    `  normalizeMediaReference,\n  normalizePublicationBody,\n  normalizePublicationLifecycleStatus,`,
  );
  update = replaceOnce(update,
`    body?: unknown;\n    mediaReference?: unknown;`,
`    status?: unknown;\n    body?: unknown;\n    mediaReference?: unknown;`,
    'update status input');
  update = replaceOnce(update,
`  const destinations = await resolveDestinationsOrPublishingError(\n    db,\n    principal.workspaceId,\n    rawInput.destinations,\n    rawInput.connectionIds,\n  );`,
`  const nextStatus = normalizePublicationLifecycleStatus(rawInput.status, current.status === 'draft' ? 'draft' : 'scheduled');\n  const destinations = await resolveDestinationsOrPublishingError(\n    db,\n    principal.workspaceId,\n    rawInput.destinations,\n    rawInput.connectionIds,\n    { allowIncomplete: nextStatus === 'draft' },\n  );`,
    'update draft destinations');
  update = replaceOnce(update,
`       SET body = ?, media_reference = ?, scheduled_at = ?, version = ?, updated_at = ?\n       WHERE id = ? AND workspace_id = ? AND version = ?`,
`       SET body = ?, media_reference = ?, status = ?, scheduled_at = ?, version = ?, updated_at = ?\n       WHERE id = ? AND workspace_id = ? AND version = ?`,
    'update dynamic status SQL');
  update = replaceOnce(update,
`    ).bind(body, mediaReference ?? null, scheduledAt, nextVersion, now, publicationId, principal.workspaceId, current.version),`,
`    ).bind(body, mediaReference ?? null, nextStatus, scheduledAt, nextVersion, now, publicationId, principal.workspaceId, current.version),`,
    'update status bind');
  update = replaceOnce(update,
`    ...destinationInsertStatements(db, principal.workspaceId, publicationId, destinations, now),\n    ...connectedLegacyTargetStatements(db, principal.workspaceId, publicationId, destinations, now),`,
`    ...destinationInsertStatements(db, principal.workspaceId, publicationId, destinations, now),\n    ...(nextStatus === 'scheduled' ? connectedLegacyTargetStatements(db, principal.workspaceId, publicationId, destinations, now) : []),`,
    'update draft targets');
  fs.writeFileSync(updatePath, update);
}

// 6) API lifecycle: audit drafts distinctly and queue YouTube only for work that really needs provider reconciliation.
const cockpitPath = 'src/worker/cockpit-production.ts';
let cockpit = fs.readFileSync(cockpitPath, 'utf8');
if (!cockpit.includes('publication.draft_saved')) {
  cockpit = cockpit.replace(
    `        body?: unknown;\n        mediaReference?: unknown;`,
    `        status?: unknown;\n        body?: unknown;\n        mediaReference?: unknown;`,
  );
  cockpit = cockpit.replace(
`      await writeAuditLog(env.DB, auth.principal, 'publication.scheduled', 'content_post', publication.id, {\n        scheduledAt: publication.scheduledAt,\n        targetCount: publication.targets.length,\n      });\n      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publication.id);`,
`      await writeAuditLog(env.DB, auth.principal, publication.status === 'draft' ? 'publication.draft_saved' : 'publication.scheduled', 'content_post', publication.id, {\n        scheduledAt: publication.scheduledAt,\n        targetCount: publication.targets.length,\n        status: publication.status,\n      });\n      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publication.id);`,
  );
  cockpit = cockpit.replace(
`      await writeAuditLog(env.DB, auth.principal, 'publication.updated', 'content_post', publicationId, {\n        scheduledAt: publication.scheduledAt,\n        targetCount: publication.targets.length,\n        version: publication.version,\n      });\n      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publicationId);`,
`      await writeAuditLog(env.DB, auth.principal, publication.status === 'draft' ? 'publication.draft_saved' : 'publication.updated', 'content_post', publicationId, {\n        scheduledAt: publication.scheduledAt,\n        targetCount: publication.targets.length,\n        version: publication.version,\n        status: publication.status,\n      });\n      await enqueueYouTubePublicationSync(env, auth.principal.workspaceId, publicationId);`,
  );
  fs.writeFileSync(cockpitPath, cockpit);
}

// 7) YouTube provider lifecycle: drafts stay local, audience is mandatory, notifications are explicit,
// and processing/rejection state is reflected instead of pretending every upload is already done.
const youtubePath = 'src/worker/youtube-publishing.ts';
let youtube = fs.readFileSync(youtubePath, 'utf8');
if (!youtube.includes('SC_YOUTUBE_PROVIDER_LIFECYCLE_V2')) {
  youtube = replaceOnce(youtube,
`export function buildYouTubeMetadata(\n  fields: Record<string, unknown>,\n  scheduledAt: string,\n  nowMs = Date.now(),\n): YoutubeMetadata {\n  const title = text(fields.title).slice(0, 100);`,
`export function buildYouTubeMetadata(\n  fields: Record<string, unknown>,\n  scheduledAt: string,\n  nowMs = Date.now(),\n): YoutubeMetadata {\n  const title = text(fields.title).slice(0, 100);`,
    'youtube metadata anchor');
  youtube = replaceOnce(youtube,
`  if (!title) throw new YouTubePublishingError('Le titre YouTube est requis avant synchronisation.');\n\n  const requestedPrivacy = text(fields.privacyStatus);`,
`  if (!title) throw new YouTubePublishingError('Le titre YouTube est requis avant synchronisation.');\n  if (typeof fields.madeForKids !== 'boolean') {\n    throw new YouTubePublishingError('Indiquez explicitement si la vidéo YouTube est conçue pour les enfants.');\n  }\n\n  const requestedPrivacy = text(fields.privacyStatus);`,
    'mandatory audience');
  youtube = youtube.replace(
    `    selfDeclaredMadeForKids: boolean(fields.madeForKids),`,
    `    selfDeclaredMadeForKids: fields.madeForKids as boolean,`,
  );

  youtube = replaceOnce(youtube,
`export async function enqueueYouTubePublicationSync(env: Env, workspaceId: string, postId: string): Promise<boolean> {\n  if (!youtubePublishingConfigured(env)) return false;\n  await markQueuedRows(env.DB, workspaceId, postId);\n  const hasWork = await env.DB.prepare(\n    \`SELECT 1 AS present FROM publication_remote_sync\n     WHERE workspace_id = ? AND post_id = ? AND platform = 'youtube' LIMIT 1\`,\n  ).bind(workspaceId, postId).first<{ present: number }>();\n  if (!hasWork) return false;\n  await env.EVENTS_QUEUE.send({ kind: 'youtube_publication_sync', workspaceId, postId } satisfies YouTubeSyncEnvelope, { contentType: 'json' });\n  return true;\n}`,
`export async function enqueueYouTubePublicationSync(env: Env, workspaceId: string, postId: string): Promise<boolean> {\n  if (!youtubePublishingConfigured(env)) return false;\n  const post = await env.DB.prepare(\`SELECT status FROM content_posts WHERE workspace_id = ? AND id = ?\`).bind(workspaceId, postId).first<{ status: string }>();\n  if (!post) return false;\n  if (post.status === 'draft') {\n    const existing = await env.DB.prepare(\n      \`SELECT 1 AS present FROM publication_remote_sync WHERE workspace_id = ? AND post_id = ? AND platform = 'youtube' LIMIT 1\`,\n    ).bind(workspaceId, postId).first<{ present: number }>();\n    if (!existing) return false;\n    await env.DB.prepare(\n      \`UPDATE publication_remote_sync SET sync_status = 'queued', last_error = NULL, updated_at = ? WHERE workspace_id = ? AND post_id = ? AND platform = 'youtube'\`,\n    ).bind(new Date().toISOString(), workspaceId, postId).run();\n  } else {\n    await markQueuedRows(env.DB, workspaceId, postId);\n  }\n  const hasWork = await env.DB.prepare(\n    \`SELECT 1 AS present FROM publication_remote_sync\n     WHERE workspace_id = ? AND post_id = ? AND platform = 'youtube' LIMIT 1\`,\n  ).bind(workspaceId, postId).first<{ present: number }>();\n  if (!hasWork) return false;\n  await env.EVENTS_QUEUE.send({ kind: 'youtube_publication_sync', workspaceId, postId } satisfies YouTubeSyncEnvelope, { contentType: 'json' });\n  return true;\n}`,
    'draft-safe enqueue');

  youtube = youtube.replace(
    `'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus',`,
    `` + "`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus&notifySubscribers=${boolean(parseFields(destination.fields_json).notifySubscribers, true) ? 'true' : 'false'}`," + ``,
  );

  youtube = replaceOnce(youtube,
`async function syncDestination(db: D1Database, env: Env, destination: YoutubeDestinationRow) {\n  let row = await upsertRemoteRow(db, destination);\n  try {\n    if (destination.post_status === 'cancelled' || destination.destination_status === 'cancelled') {`,
`async function syncDestination(db: D1Database, env: Env, destination: YoutubeDestinationRow) {\n  let row = await upsertRemoteRow(db, destination);\n  try {\n    if (destination.post_status === 'draft' || destination.post_status === 'cancelled' || destination.destination_status === 'cancelled') {`,
    'draft provider cleanup');

  youtube = replaceOnce(youtube,
`    const syncStatus = metadata.status.publishAt ? 'scheduled' : 'uploaded';\n    const now = new Date().toISOString();`,
`    const stateUrl = new URL('https://www.googleapis.com/youtube/v3/videos');\n    stateUrl.searchParams.set('part', 'status,processingDetails');\n    stateUrl.searchParams.set('id', externalId);\n    const stateResponse = await providerRequest(db, env, destination.workspace_id, destination.connection_id, stateUrl.toString(), { method: 'GET' });\n    if (!stateResponse.ok) throw await providerError(stateResponse, 'Impossible de vérifier le traitement YouTube');\n    const statePayload = await stateResponse.json() as { items?: Array<{ status?: { uploadStatus?: unknown; rejectionReason?: unknown; failureReason?: unknown; privacyStatus?: unknown }; processingDetails?: { processingStatus?: unknown } }> };\n    const state = statePayload.items?.[0];\n    const uploadStatus = text(state?.status?.uploadStatus);\n    const processingStatus = text(state?.processingDetails?.processingStatus);\n    if (uploadStatus === 'rejected' || uploadStatus === 'failed' || processingStatus === 'failed') {\n      const reason = text(state?.status?.rejectionReason) || text(state?.status?.failureReason) || 'YouTube a rejeté le traitement de cette vidéo.';\n      throw new YouTubePublishingError(reason);\n    }\n    const providerPrivacy = text(state?.status?.privacyStatus);\n    const syncStatus = processingStatus === 'processing'\n      ? 'processing'\n      : metadata.status.publishAt\n        ? 'scheduled'\n        : providerPrivacy === 'public' || metadata.status.privacyStatus === 'public'\n          ? 'published'\n          : 'uploaded';\n    const now = new Date().toISOString();`,
    'youtube processing state');

  youtube = youtube.replaceAll(
    `current.post_status === 'cancelled' || current.destination_status === 'cancelled'`,
    `current.post_status === 'draft' || current.post_status === 'cancelled' || current.destination_status === 'cancelled'`,
  );
  youtube = youtube.replaceAll(
    `destination.post_status === 'cancelled' || destination.destination_status === 'cancelled'`,
    `destination.post_status === 'draft' || destination.post_status === 'cancelled' || destination.destination_status === 'cancelled'`,
  );

  youtube = youtube.replace(
`       AND (rs.id IS NULL OR rs.sync_status = 'queued' OR (rs.sync_status = 'syncing' AND rs.updated_at < ?))\n     ORDER BY p.scheduled_at ASC`,
`       AND (\n         (p.scheduled_at > ? AND (rs.id IS NULL OR rs.sync_status = 'queued' OR (rs.sync_status = 'syncing' AND rs.updated_at < ?)))\n         OR rs.sync_status = 'processing'\n         OR (rs.sync_status = 'scheduled' AND p.scheduled_at <= ?)\n       )\n     ORDER BY p.scheduled_at ASC`,
  );
  youtube = youtube.replace(
    `  ).bind(now, stale, Math.max(1, Math.min(100, limit))).all<{ workspace_id: string; post_id: string }>();`,
    `  ).bind(now, stale, now, Math.max(1, Math.min(100, limit))).all<{ workspace_id: string; post_id: string }>();`,
  );
  youtube += `\n// SC_YOUTUBE_PROVIDER_LIFECYCLE_V2\n`;
  fs.writeFileSync(youtubePath, youtube);
}

// 8) Frontend: save real drafts, require the YouTube audience only when scheduling,
// and show statuses that match what actually happened.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_YOUTUBE_COMPOSER_LIFECYCLE_V2')) {
  app = app.replace(
    `import type { PlanningPlatform } from './shared/social-publication-fields';`,
    `import { missingRequiredPlanningFields, type PlanningPlatform } from './shared/social-publication-fields';`,
  );

  app = replaceOnce(app,
`  async function schedulePublication() {`,
`  async function savePublication(nextStatus: 'draft' | 'scheduled' = 'scheduled') {`,
    'save function');

  app = replaceOnce(app,
`    if (!runtime.publishingSchedulerReady) {\n      setToast('Le Planner n’est pas disponible.');\n      return;\n    }`,
`    if (!runtime.publishingSchedulerReady) {\n      setToast('Le Planner n’est pas disponible.');\n      return;\n    }`,
    'planner readiness no-op');

  app = replaceOnce(app,
`      const requestPayload = {\n        body,\n        mediaReference,\n        scheduledAt,\n        connectionIds: selectedConnectionIds,\n        destinations,\n      };`,
`      const requestPayload = {\n        status: nextStatus,\n        body,\n        mediaReference,\n        scheduledAt,\n        connectionIds: selectedConnectionIds,\n        destinations,\n      };`,
    'request lifecycle status');

  app = app.replace(
    `        setToast('Modifications enregistrées.');`,
    `        setToast(nextStatus === 'draft' ? 'Brouillon enregistré.' : 'Modifications enregistrées.');`,
  );
  app = app.replace(
    `        setToast(result.publication.targets.some((target) => !target.connected) ? 'Ajoutée au Planner. La connexion du compte pourra être faite plus tard.' : 'Publication ajoutée au Planner.');`,
    `        setToast(nextStatus === 'draft' ? 'Brouillon enregistré.' : result.publication.targets.some((target) => !target.connected) ? 'Ajoutée au Planner. La connexion du compte pourra être faite plus tard.' : 'Publication programmée.');`,
  );

  app = app.replace(
    `              onSchedule={() => void schedulePublication()}`,
    `              onSchedule={() => void savePublication('scheduled')}\n              onSaveDraft={() => void savePublication('draft')}`,
  );

  app = replaceOnce(app,
`function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {`,
`function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onSaveDraft, onBack, onCancel }: {`,
    'create draft action signature');

  app = replaceOnce(app,
`  onSchedule: () => void;\n  onBack: () => void;`,
`  onSchedule: () => void;\n  onSaveDraft: () => void;\n  onBack: () => void;`,
    'create draft action type');

  app = replaceOnce(app,
`    const selectedCount = selectedIds.length + plannedPlatforms.length;`,
`    const selectedCount = selectedIds.length + plannedPlatforms.length;\n    const incompleteDestinations = previewDestinations.filter((destination) => missingRequiredPlanningFields(destination.platform, destination.format, destination.fields).length > 0);\n    const incompleteLabels = [...new Set(incompleteDestinations.flatMap((destination) => missingRequiredPlanningFields(destination.platform, destination.format, destination.fields)))];`,
    'guided completion state');

  app = app.replace(
`<div className="sc9-validate-card"><div><CalendarDays size={16} /><span><small>Programmée pour</small><strong>{scheduleLabel}</strong><em className="sc12-timezone">{scheduleTimeZone}</em></span></div><button type="button" className="sc3-primary wide" disabled={busy || incompatibleDestinations.length > 0 || !selectedCount || !scheduleDateValue} onClick={onSchedule}>{busy ? 'Enregistrement…' : 'Valider la publication'} <Check size={16} /></button></div>`,
`<div className="sc9-validate-card"><div><CalendarDays size={16} /><span><small>Programmée pour</small><strong>{scheduleLabel}</strong><em className="sc12-timezone">{scheduleTimeZone}</em></span></div>{incompleteLabels.length > 0 && <div className="sc16-completion-warning"><AlertTriangle size={14} /><span><strong>À compléter avant publication</strong><small>{incompleteLabels.join(' · ')}</small></span></div>}<div className="sc16-compose-actions">{(!editingPublication || editingPublication.status === 'draft') && <button type="button" className="sc16-draft-button" disabled={busy || !selectedCount} onClick={onSaveDraft}>{busy ? 'Enregistrement…' : 'Enregistrer en brouillon'}</button>}<button type="button" className="sc3-primary wide" disabled={busy || incompatibleDestinations.length > 0 || incompleteDestinations.length > 0 || !selectedCount || !scheduleDateValue} onClick={onSchedule}>{busy ? 'Enregistrement…' : editingPublication?.status === 'draft' ? 'Programmer la publication' : 'Valider la publication'} <Check size={16} /></button></div></div>`,
  );

  app = app.replace(
`  const plannerDrawerStatus = plannerHasSyncFailure ? 'Erreur de diffusion'\n    : plannerNeedsConnection ? 'Compte à connecter'\n      : plannerDrawerReady ? 'Publication planifiée'\n        : editingPublication ? 'Planification incomplète' : 'Nouvelle publication';`,
`  const plannerDraftIncomplete = Boolean(editingPublication?.status === 'draft' && editingPublication.targets.some((target) => missingRequiredPlanningFields(target.platform, target.format, target.fields).length > 0));\n  const plannerDrawerStatus = plannerHasSyncFailure ? 'Erreur de diffusion'\n    : editingPublication?.status === 'draft' ? (plannerDraftIncomplete ? 'À compléter' : 'Brouillon')\n      : plannerNeedsConnection ? 'Compte à connecter'\n        : youtubeTarget?.syncStatus === 'processing' || youtubeTarget?.syncStatus === 'syncing' || youtubeTarget?.syncStatus === 'queued' ? 'En cours d’envoi'\n          : youtubeTarget?.syncStatus === 'scheduled' ? 'Programmé sur YouTube'\n            : plannerDrawerReady ? 'Publication planifiée'\n              : editingPublication ? 'Planification incomplète' : 'Nouvelle publication';`,
  );

  app = app.replace(
`{plannerNeedsConnection ? <small className="sc14-card-readiness needs-connection">À connecter</small> : plannerSyncFailed ? <small className="sc14-card-readiness error">Erreur</small> : plannerPrivacy && <small className={\`sc13-card-visibility \${plannerPrivacy}\`}>{plannerPrivacy === 'public' ? '🌍 Publique' : plannerPrivacy === 'unlisted' ? '🔗 Non répertoriée' : '🔒 Privée'}</small>}`,
`{publication.status === 'draft' ? <small className="sc16-lifecycle-badge draft">Brouillon</small> : plannerNeedsConnection ? <small className="sc14-card-readiness needs-connection">À connecter</small> : plannerSyncFailed ? <small className="sc14-card-readiness error">Erreur</small> : plannerYouTubeTarget?.syncStatus === 'processing' || plannerYouTubeTarget?.syncStatus === 'syncing' || plannerYouTubeTarget?.syncStatus === 'queued' ? <small className="sc16-lifecycle-badge sending">Envoi…</small> : plannerYouTubeTarget?.syncStatus === 'scheduled' ? <small className="sc16-lifecycle-badge youtube-scheduled">YouTube ✓</small> : plannerPrivacy && <small className={\`sc13-card-visibility \${plannerPrivacy}\`}>{plannerPrivacy === 'public' ? '🌍 Publique' : plannerPrivacy === 'unlisted' ? '🔗 Non répertoriée' : '🔒 Privée'}</small>}`,
  );

  app = app.replace(
`<span><time>{formatTime(publication.scheduledAt)}</time>{publication.readOnly && <em>{publication.providerStatus === 'scheduled' ? 'Programmé' : 'Publié'}</em>}</span>`,
`<span><time>{formatTime(publication.scheduledAt)}</time>{publication.readOnly ? <em>{publication.providerStatus === 'scheduled' ? 'Programmé' : 'Publié'}</em> : publication.status === 'draft' ? <em className="sc16-month-status draft">Brouillon</em> : <em className="sc16-month-status scheduled">Programmé</em>}</span>`,
  );

  app = app.replace(
`<span><strong>{publication.body}</strong><small>{publication.targets.map((target) => target.displayName).join(' · ')}</small></span>`,
`<span><strong>{publication.body}</strong><small>{publication.targets.map((target) => target.displayName).join(' · ')}</small><em className={\`sc16-list-status \${publication.status === 'draft' ? 'draft' : 'scheduled'}\`}>{publication.status === 'draft' ? 'Brouillon' : 'Programmé'}</em></span>`,
  );

  app += `\n// SC_YOUTUBE_COMPOSER_LIFECYCLE_V2\n`;
  fs.writeFileSync(appPath, app);
}

// 9) UI styling.
const cssPath = 'src/youtube-lifecycle-v2.css';
if (!fs.existsSync(cssPath)) {
  fs.writeFileSync(cssPath, `
.sc16-boolean-choice{border:0;margin:0;padding:0;min-width:0}.sc16-boolean-choice legend{display:flex;gap:8px;align-items:center;font-weight:750;color:#14163a;margin-bottom:9px}.sc16-boolean-choice legend b{font-size:10px;padding:3px 7px;border-radius:999px;background:#f0edff;color:#6d42f5}.sc16-boolean-choice>div{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sc16-boolean-choice button{display:grid;grid-template-columns:1fr auto;gap:2px 8px;text-align:left;padding:11px 12px;border:1px solid #e4e6f0;border-radius:13px;background:#fff;color:#14163a}.sc16-boolean-choice button span{font-weight:800}.sc16-boolean-choice button small{grid-column:1/2;color:#7b819b}.sc16-boolean-choice button.active{border-color:#8168ff;background:#f7f5ff;box-shadow:0 0 0 2px rgba(129,104,255,.08)}.sc16-boolean-choice>small{display:block;margin-top:7px;color:#7b819b}
.sc16-compose-actions{display:grid;grid-template-columns:minmax(150px,.7fr) minmax(220px,1.3fr);gap:9px;margin-top:10px}.sc16-draft-button{border:1px solid #dde0ed;background:#fff;border-radius:12px;padding:11px 14px;font-weight:800;color:#3f4561}.sc16-draft-button:hover{background:#f8f8fc}.sc16-completion-warning{display:flex;gap:9px;align-items:flex-start;margin-top:10px;padding:10px 12px;border-radius:12px;background:#fff8e8;color:#8b5f00}.sc16-completion-warning span{display:grid;gap:2px}.sc16-completion-warning small{color:#9c741f}
.sc16-lifecycle-badge,.sc16-month-status,.sc16-list-status{display:inline-flex;align-items:center;width:max-content;border-radius:999px;font-style:normal;font-weight:800}.sc16-lifecycle-badge{font-size:9px;padding:2px 6px}.sc16-lifecycle-badge.draft,.sc16-month-status.draft,.sc16-list-status.draft{background:#f0f1f6;color:#697089}.sc16-lifecycle-badge.sending{background:#eef4ff;color:#3f67c8}.sc16-lifecycle-badge.youtube-scheduled{background:#eaf8ef;color:#28734a}.sc16-month-status{font-size:9px;padding:2px 5px}.sc16-month-status.scheduled,.sc16-list-status.scheduled{background:#eaf8ef;color:#28734a}.sc16-list-status{font-size:10px;padding:3px 7px;margin-top:4px}
@media(max-width:760px){.sc16-boolean-choice>div,.sc16-compose-actions{grid-template-columns:1fr}}
`);
}
const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./youtube-lifecycle-v2.css")) {
  main += `\nimport './youtube-lifecycle-v2.css';\n`;
  fs.writeFileSync(mainPath, main);
}

console.log('YouTube lifecycle v2 and real drafts applied.');
