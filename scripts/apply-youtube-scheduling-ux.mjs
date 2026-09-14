import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`YouTube scheduling UX patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) New YouTube publications should naturally become public at the scheduled time,
// while keeping private as an explicit opt-in choice.
const fieldsPath = 'src/shared/social-publication-fields.ts';
let fields = fs.readFileSync(fieldsPath, 'utf8');
if (!fields.includes('Publique à l’heure programmée')) {
  fields = replaceOnce(
    fields,
    `const visibilityOptions: PublicationFieldOption[] = [\n  { value: 'private', label: 'Privée' },\n  { value: 'unlisted', label: 'Non répertoriée' },\n  { value: 'public', label: 'Publique' },\n];`,
    `const visibilityOptions: PublicationFieldOption[] = [\n  { value: 'public', label: 'Publique à l’heure programmée' },\n  { value: 'private', label: 'Privée — restera privée' },\n  { value: 'unlisted', label: 'Non répertoriée' },\n];`,
    'YouTube visibility labels',
  );
  fields = replaceOnce(
    fields,
    `      result[field.key] = field.key === 'privacyStatus' ? 'private' : field.options[0]?.value ?? '';`,
    `      result[field.key] = field.key === 'privacyStatus' ? 'public' : field.options[0]?.value ?? '';`,
    'YouTube default visibility',
  );
  fs.writeFileSync(fieldsPath, fields);
}

// 2) Make browser-local schedule conversion explicit and DST-safe, then surface
// the exact timezone alongside the user-facing date and time.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('sc12-youtube-schedule-choice')) {
  app = replaceOnce(
    app,
    `function localDateKey(date: Date) {\n  const year = date.getFullYear();\n  const month = String(date.getMonth() + 1).padStart(2, '0');\n  const day = String(date.getDate()).padStart(2, '0');\n  return \`\${year}-\${month}-\${day}\`;\n}`,
    `function localDateKey(date: Date) {\n  const year = date.getFullYear();\n  const month = String(date.getMonth() + 1).padStart(2, '0');\n  const day = String(date.getDate()).padStart(2, '0');\n  return \`\${year}-\${month}-\${day}\`;\n}\n\nfunction browserTimeZone() {\n  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Heure locale';\n}\n\nfunction localScheduleDate(dateKey: string, time: string): Date | undefined {\n  const dateMatch = dateKey.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);\n  const timeMatch = time.match(/^(\\d{2}):(\\d{2})$/);\n  if (!dateMatch || !timeMatch) return undefined;\n  const year = Number(dateMatch[1]);\n  const month = Number(dateMatch[2]);\n  const day = Number(dateMatch[3]);\n  const hours = Number(timeMatch[1]);\n  const minutes = Number(timeMatch[2]);\n  if (month < 1 || month > 12 || day < 1 || day > 31 || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;\n  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);\n  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hours || date.getMinutes() !== minutes) return undefined;\n  return date;\n}`,
    'local schedule helpers',
  );

  app = replaceOnce(
    app,
    `    const scheduledAt = publishNow && runtime.contentPublishingReady\n      ? new Date(Date.now() + 30_000).toISOString()\n      : new Date(\`\${scheduleDate}T\${scheduleTime}:00\`).toISOString();\n    if (new Date(scheduledAt).getTime() < Date.now() - 30_000) {`,
    `    const scheduledDate = publishNow && runtime.contentPublishingReady\n      ? new Date(Date.now() + 30_000)\n      : localScheduleDate(scheduleDate, scheduleTime);\n    if (!scheduledDate) {\n      setToast('Cette date ou cette heure locale n’existe pas dans votre fuseau horaire.');\n      return;\n    }\n    const scheduledAt = scheduledDate.toISOString();\n    if (scheduledDate.getTime() < Date.now() - 30_000) {`,
    'schedule UTC conversion',
  );

  app = replaceOnce(
    app,
    `    const next = new Date(\`\${targetDateKey}T\${String(hours).padStart(2, '0')}:\${String(mins).padStart(2, '0')}:00\`);\n    if (next.getTime() < Date.now() - 30_000) {`,
    `    const next = localScheduleDate(targetDateKey, \`\${String(hours).padStart(2, '0')}:\${String(mins).padStart(2, '0')}\`);\n    if (!next) {\n      setToast('Cet horaire local n’existe pas dans votre fuseau horaire.');\n      return;\n    }\n    if (next.getTime() < Date.now() - 30_000) {`,
    'drag drop timezone conversion',
  );

  app = replaceOnce(
    app,
    `  const scheduleLabel = publishNow\n    ? 'Dès que possible'\n    : new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(\`\${scheduleDate}T\${scheduleTime}:00\`));`,
    `  const scheduleDateValue = localScheduleDate(scheduleDate, scheduleTime);\n  const scheduleTimeZone = browserTimeZone();\n  const scheduleLabel = publishNow\n    ? 'Dès que possible'\n    : scheduleDateValue\n      ? new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(scheduleDateValue)\n      : 'Horaire invalide';`,
    'schedule display timezone state',
  );

  app = replaceOnce(
    app,
    `  if (!editingPublication) {\n    const compatiblePlatforms = selectedMedia ? guidedCompatiblePlatforms(selectedMedia.format) : [];\n    const selectedCount = selectedIds.length + plannedPlatforms.length;`,
    `  if (!editingPublication) {\n    const compatiblePlatforms = selectedMedia ? guidedCompatiblePlatforms(selectedMedia.format) : [];\n    const selectedCount = selectedIds.length + plannedPlatforms.length;\n    const activeGuidedDestination = previewDestinations[Math.min(Math.max(previewIndex, 0), Math.max(0, previewDestinations.length - 1))];\n    const activeGuidedDraftKey = activeGuidedDestination?.platform === 'youtube'\n      ? activeGuidedDestination.connectionId\n        ? connectionDestinationKey(activeGuidedDestination.connectionId)\n        : plannedDestinationKey('youtube')\n      : undefined;\n    const activeGuidedDraft = activeGuidedDraftKey ? destinationDrafts[activeGuidedDraftKey] : undefined;\n    const activeYoutubePrivacy = activeGuidedDraft?.fields.privacyStatus === 'private' ? 'private' : 'public';`,
    'guided YouTube visibility state',
  );

  app = replaceOnce(
    app,
    `{activePreviewDestination && <div className="sc9-active-network"><PlatformMark platform={activePreviewDestination.platform} size={17} /><span><strong>{activePreviewDestination.accountLabel}</strong><small>{platformLabel(activePreviewDestination.platform)} · {activePreviewDestination.format}</small></span></div>}\n            <div className="sc9-fields">`,
    `{activePreviewDestination && <div className="sc9-active-network"><PlatformMark platform={activePreviewDestination.platform} size={17} /><span><strong>{activePreviewDestination.accountLabel}</strong><small>{platformLabel(activePreviewDestination.platform)} · {activePreviewDestination.format}</small></span></div>}\n            {activeGuidedDestination?.platform === 'youtube' && activeGuidedDraftKey && activeGuidedDraft && (\n              <div className="sc12-youtube-schedule-choice">\n                <div className="sc12-choice-head"><strong>Visibilité sur YouTube</strong><small>Que doit-il se passer à l’heure programmée ?</small></div>\n                <div className="sc12-choice-options">\n                  <button type="button" className={activeYoutubePrivacy === 'public' ? 'active' : ''} onClick={() => onDestinationDraft(activeGuidedDraftKey, { ...activeGuidedDraft, fields: { ...activeGuidedDraft.fields, privacyStatus: 'public' } })}>\n                    <span aria-hidden="true">🌍</span><span><strong>Publique à l’heure programmée</strong><small>La vidéo reste privée jusque-là, puis YouTube la rend publique automatiquement.</small></span>{activeYoutubePrivacy === 'public' && <Check size={16} />}\n                  </button>\n                  <button type="button" className={activeYoutubePrivacy === 'private' ? 'active' : ''} onClick={() => onDestinationDraft(activeGuidedDraftKey, { ...activeGuidedDraft, fields: { ...activeGuidedDraft.fields, privacyStatus: 'private' } })}>\n                    <span aria-hidden="true">🔒</span><span><strong>Privée</strong><small>La vidéo restera privée même après l’heure prévue.</small></span>{activeYoutubePrivacy === 'private' && <Check size={16} />}\n                  </button>\n                </div>\n                <div className="sc12-schedule-confirm"><Clock3 size={15} /><span><small>{activeYoutubePrivacy === 'public' ? 'Publication publique prévue' : 'Envoi privé prévu'}</small><strong>{scheduleLabel}</strong><em>{scheduleTimeZone}</em></span></div>\n              </div>\n            )}\n            <div className="sc9-fields">`,
    'guided YouTube visibility cards',
  );

  app = replaceOnce(
    app,
    `<div className="sc9-validate-card"><div><CalendarDays size={16} /><span><small>Programmée pour</small><strong>{scheduleLabel}</strong></span></div><button type="button" className="sc3-primary wide" disabled={busy || incompatibleDestinations.length > 0 || !selectedCount} onClick={onSchedule}>{busy ? 'Enregistrement…' : 'Valider la publication'} <Check size={16} /></button></div>`,
    `<div className="sc9-validate-card"><div><CalendarDays size={16} /><span><small>Programmée pour</small><strong>{scheduleLabel}</strong><em className="sc12-timezone">{scheduleTimeZone}</em></span></div><button type="button" className="sc3-primary wide" disabled={busy || incompatibleDestinations.length > 0 || !selectedCount || !scheduleDateValue} onClick={onSchedule}>{busy ? 'Enregistrement…' : 'Valider la publication'} <Check size={16} /></button></div>`,
    'guided schedule timezone summary',
  );

  app = replaceOnce(
    app,
    `<div><small>Publication prévue</small><strong>{scheduleLabel}</strong></div>`,
    `<div><small>Publication prévue</small><strong>{scheduleLabel}</strong><em className="sc12-timezone">{scheduleTimeZone}</em></div>`,
    'edit drawer timezone summary',
  );

  fs.writeFileSync(appPath, app);
}

console.log('YouTube visibility and timezone scheduling UX applied.');
