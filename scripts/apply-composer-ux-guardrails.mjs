import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Composer UX guardrails patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');

if (!app.includes('SC_COMPOSER_UX_GUARDRAILS_V1')) {
  // Helpers used by every scheduling entry point. Manual schedules must stay safely in the future.
  app = replaceOnce(
    app,
    `  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hours || date.getMinutes() !== minutes) return undefined;\n  return date;\n}`,
    `  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hours || date.getMinutes() !== minutes) return undefined;\n  return date;\n}\n\nfunction localTimeKey(date: Date) {\n  return \`${'${String(date.getHours()).padStart(2, \'0\')}:${String(date.getMinutes()).padStart(2, \'0\')}' }\`;\n}\n\nfunction nextSchedulableLocalDate(stepMinutes = 5) {\n  const next = new Date(Date.now() + 60_000);\n  next.setSeconds(0, 0);\n  const remainder = next.getMinutes() % stepMinutes;\n  if (remainder) next.setMinutes(next.getMinutes() + (stepMinutes - remainder));\n  return next;\n}`,
    'local schedule helpers',
  );

  // Clicking an old Planner slot must never prefill an invalid past date/time.
  app = replaceOnce(
    app,
    `    if (dateKey) setScheduleDate(dateKey);\n    if (minutes !== undefined) {\n      const hours = Math.floor(minutes / 60);\n      const mins = minutes % 60;\n      setScheduleTime(\`${'${String(hours).padStart(2, \'0\')}:${String(mins).padStart(2, \'0\')}' }\`);\n    }`,
    `    if (dateKey || minutes !== undefined) {\n      const requestedDateKey = dateKey ?? scheduleDate;\n      const requestedTime = minutes !== undefined\n        ? \`${'${String(Math.floor(minutes / 60)).padStart(2, \'0\')}:${String(minutes % 60).padStart(2, \'0\')}' }\`\n        : scheduleTime;\n      const requested = localScheduleDate(requestedDateKey, requestedTime);\n      if (requested && requested.getTime() >= Date.now() + 60_000) {\n        setScheduleDate(requestedDateKey);\n        setScheduleTime(requestedTime);\n      } else {\n        const safe = nextSchedulableLocalDate();\n        setScheduleDate(localDateKey(safe));\n        setScheduleTime(localTimeKey(safe));\n        setToast('Ce créneau est déjà passé. Le prochain horaire disponible a été sélectionné.');\n      }\n    }`,
    'clamp quick-add past slots',
  );

  // Client-side fail-fast for schedule and drag/drop. Drafts can still be saved.
  app = app.replace(
    `    if (scheduledDate.getTime() < Date.now() - 30_000) {\n      setToast('Choisissez une date et une heure futures.');`,
    `    if (!publishNow && scheduledDate.getTime() < Date.now() + 60_000) {\n      setToast('Choisissez un horaire au moins une minute dans le futur.');`,
  );
  app = app.replace(
    `    if (next.getTime() < Date.now() - 30_000) {\n      setToast('Impossible de déplacer une publication dans le passé.');`,
    `    if (next.getTime() < Date.now() + 60_000) {\n      setToast('Impossible de déplacer une publication sur un horaire déjà passé ou trop proche.');`,
  );

  // Shared timing state for guided creation and edit mode.
  app = replaceOnce(
    app,
    `  const activePreviewDestination = previewDestinations[Math.min(Math.max(previewIndex, 0), Math.max(0, previewDestinations.length - 1))];`,
    `  const scheduleMinimum = nextSchedulableLocalDate();\n  const todayDateKey = localDateKey(new Date());\n  const minimumTimeToday = localTimeKey(scheduleMinimum);\n  const scheduleTooSoon = !publishNow && (!scheduleDateValue || scheduleDateValue.getTime() < Date.now() + 60_000);\n  const activePreviewDestination = previewDestinations[Math.min(Math.max(previewIndex, 0), Math.max(0, previewDestinations.length - 1))];`,
    'schedule validity state',
  );

  // Make the network-specific area explicit instead of letting it visually blend into generic composer controls.
  app = replaceOnce(
    app,
    `{activePreviewDestination && <div className="sc9-active-network"><PlatformMark platform={activePreviewDestination.platform} size={17} /><span><strong>{activePreviewDestination.accountLabel}</strong><small>{platformLabel(activePreviewDestination.platform)} · {activePreviewDestination.format}</small></span></div>}`,
    `{activePreviewDestination && <div className={\`sc17-network-context sc17-\${activePreviewDestination.platform}\`}><div className="sc17-network-icon"><PlatformMark platform={activePreviewDestination.platform} size={18} /></div><span><small>PARAMÈTRES SPÉCIFIQUES AU RÉSEAU</small><strong>{platformLabel(activePreviewDestination.platform)} · {activePreviewDestination.accountLabel}</strong><em>{activePreviewDestination.format} · Ces réglages s’appliquent uniquement à cette destination.</em></span></div>}`,
    'guided network context',
  );

  app = replaceOnce(
    app,
    `            <div className="sc9-fields">\n              <PlatformDestinationEditor`,
    `            <div className={\`sc9-fields sc17-platform-fields\${activeGuidedDestination ? \` sc17-\${activeGuidedDestination.platform}\` : ''}\`}>\n              {activeGuidedDestination && <div className="sc17-settings-heading"><span>Réglages {platformLabel(activeGuidedDestination.platform)}</span><small>Le reste du parcours (date, heure et brouillon) est séparé juste en dessous.</small></div>}\n              <PlatformDestinationEditor`,
    'guided platform settings wrapper',
  );

  // Replace the cramped final area with a clear timing step + separate actions.
  app = replaceOnce(
    app,
    `<div className="sc9-validate-card"><div><CalendarDays size={16} /><span><small>Programmée pour</small><strong>{scheduleLabel}</strong><em className="sc12-timezone">{scheduleTimeZone}</em></span></div>{incompleteLabels.length > 0 && <div className="sc16-completion-warning"><AlertTriangle size={14} /><span><strong>À compléter avant publication</strong><small>{incompleteLabels.join(' · ')}</small></span></div>}<div className="sc16-compose-actions"><button type="button" className="sc16-draft-button" disabled={busy || !selectedCount} onClick={onSaveDraft}>{busy ? 'Enregistrement…' : 'Enregistrer en brouillon'}</button><button type="button" className="sc3-primary wide" disabled={busy || incompatibleDestinations.length > 0 || incompleteDestinations.length > 0 || !selectedCount || !scheduleDateValue} onClick={onSchedule}>{busy ? 'Enregistrement…' : 'Programmer la publication'} <Check size={16} /></button></div></div>`,
    `<section className="sc17-timing-section"><header><span><small>ÉTAPE FINALE</small><strong>Quand publier ?</strong></span><Clock3 size={17} /></header>{deliveryReady && <div className="sc17-timing-mode"><button type="button" className={publishNow ? 'active' : ''} onClick={() => onNow(true)}><Zap size={15} /><span><strong>Maintenant</strong><small>Publier dès que possible</small></span></button><button type="button" className={!publishNow ? 'active' : ''} onClick={() => onNow(false)}><CalendarDays size={15} /><span><strong>Programmer</strong><small>Choisir une date et une heure</small></span></button></div>}{!publishNow && <div className="sc17-date-time-fields"><label><span>Date</span><input type="date" min={todayDateKey} value={scheduleDate} onChange={(event) => { const value = event.target.value; onDate(value); if (value === todayDateKey && scheduleTime < minimumTimeToday) onTime(minimumTimeToday); }} /></label><label><span>Heure</span><input type="time" min={scheduleDate === todayDateKey ? minimumTimeToday : undefined} value={scheduleTime} onChange={(event) => onTime(event.target.value)} /></label></div>}<div className={\`sc17-timing-summary\${scheduleTooSoon ? ' invalid' : ''}\`}><CalendarDays size={15} /><span><small>{publishNow ? 'Publication immédiate' : scheduleTooSoon ? 'Horaire à corriger' : 'Publication programmée'}</small><strong>{scheduleLabel}</strong><em>{scheduleTimeZone}</em></span></div>{scheduleTooSoon && <div className="sc17-time-warning"><AlertTriangle size={14} /><span>La date et l’heure doivent être au moins une minute dans le futur. Pour aujourd’hui, le prochain créneau proposé est {minimumTimeToday}.</span></div>}</section><div className="sc9-validate-card sc17-final-actions">{incompleteLabels.length > 0 && <div className="sc16-completion-warning"><AlertTriangle size={14} /><span><strong>À compléter avant publication</strong><small>{incompleteLabels.join(' · ')}</small></span></div>}<div className="sc16-compose-actions"><button type="button" className="sc16-draft-button" disabled={busy || !selectedCount} onClick={onSaveDraft}>{busy ? 'Enregistrement…' : 'Enregistrer en brouillon'}</button><button type="button" className="sc3-primary wide" disabled={busy || incompatibleDestinations.length > 0 || incompleteDestinations.length > 0 || !selectedCount || !scheduleDateValue || scheduleTooSoon} onClick={onSchedule}>{busy ? 'Enregistrement…' : publishNow ? 'Publier maintenant' : 'Programmer la publication'} <Check size={16} /></button></div></div>`,
    'guided timing and actions',
  );

  // Edit mode uses the same minimum time and can no longer submit an expired schedule.
  app = app.replace(
    `<label>Date<input type="date" min={localDateKey(new Date())} value={scheduleDate} onChange={(event) => onDate(event.target.value)} /></label><label>Heure<input type="time" value={scheduleTime} onChange={(event) => onTime(event.target.value)} /></label>`,
    `<label>Date<input type="date" min={todayDateKey} value={scheduleDate} onChange={(event) => { const value = event.target.value; onDate(value); if (value === todayDateKey && scheduleTime < minimumTimeToday) onTime(minimumTimeToday); }} /></label><label>Heure<input type="time" min={scheduleDate === todayDateKey ? minimumTimeToday : undefined} value={scheduleTime} onChange={(event) => onTime(event.target.value)} /></label>`,
  );
  app = app.replace(
    `disabled={busy || (!selectedIds.length && !plannedPlatforms.length) || incompatibleDestinations.length > 0}`,
    `disabled={busy || (!selectedIds.length && !plannedPlatforms.length) || incompatibleDestinations.length > 0 || scheduleTooSoon}`,
  );

  // Past days remain readable in month view but no longer offer a misleading + action.
  app = replaceOnce(
    app,
    `                const isToday = key === localDateKey(new Date());\n                const visibleItems = dayItems.slice(0, 3);`,
    `                const isToday = key === localDateKey(new Date());\n                const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);\n                const isPastDay = endOfDay.getTime() < Date.now();\n                const visibleItems = dayItems.slice(0, 3);`,
    'month past day state',
  );
  app = replaceOnce(
    app,
    `                        className="sc15-day-add"\n                        onClick={() => onCreate(key, 10 * 60)}\n                        aria-label={\`Ajouter une publication le \${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(day)}\`}\n                        title="Ajouter une publication"`,
    `                        className="sc15-day-add"\n                        disabled={isPastDay}\n                        onClick={() => !isPastDay && onCreate(key, 10 * 60)}\n                        aria-label={isPastDay ? 'Date passée' : \`Ajouter une publication le \${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(day)}\`}\n                        title={isPastDay ? 'Impossible de programmer dans le passé' : 'Ajouter une publication'}`,
    'disable month past add',
  );

  app += `\n// SC_COMPOSER_UX_GUARDRAILS_V1\n`;
  fs.writeFileSync(appPath, app);
}

// Network editor: every card explicitly says which social network owns the settings below it.
const editorPath = 'src/PlatformDestinationEditor.tsx';
let editor = fs.readFileSync(editorPath, 'utf8');
if (!editor.includes('sc17-platform-card')) {
  editor = replaceOnce(
    editor,
    `<article key={draft.key} className="sc4-network-card">`,
    `<article key={draft.key} className={\`sc4-network-card sc17-platform-card sc17-\${draft.platform}\`}>`,
    'platform card class',
  );
  editor = replaceOnce(
    editor,
    `                </header>\n                {!draft.connectionId && (`,
    `                </header>\n                {mode !== 'content' && <div className="sc17-settings-intro"><small>PARAMÈTRES {schema.label.toUpperCase()}</small><strong>Réglages spécifiques à {schema.label}</strong><span>Ces options ne modifient que cette destination. Les autres réseaux gardent leurs propres réglages.</span></div>}\n                {!draft.connectionId && (`,
    'platform settings intro',
  );
  fs.writeFileSync(editorPath, editor);
}

// Backend is authoritative: a client cannot bypass the UI and persist a scheduled publication in the past.
const publishingPath = 'src/worker/publishing.ts';
let publishing = fs.readFileSync(publishingPath, 'utf8');
if (publishing.includes(`if (date.getTime() < Date.now() - 60_000) {`)) {
  publishing = publishing.replace(
    `if (date.getTime() < Date.now() - 60_000) {`,
    `if (date.getTime() < Date.now()) {`,
  );
  fs.writeFileSync(publishingPath, publishing);
}

const cssPath = 'src/composer-ux-guardrails.css';
if (!fs.existsSync(cssPath)) {
  fs.writeFileSync(cssPath, `
/* Clear ownership of network-specific settings */
.sc17-network-context{margin:0 0 12px;padding:12px 13px;border:1px solid #dddff0;border-radius:16px;background:#14163a;color:#fff;display:grid;grid-template-columns:38px minmax(0,1fr);gap:11px;align-items:center;box-shadow:0 8px 24px rgba(20,22,58,.10)}
.sc17-network-icon{width:38px;height:38px;border-radius:12px;background:rgba(255,255,255,.08);display:grid;place-items:center}.sc17-network-icon .sc3-platform{width:30px;height:30px;border-radius:10px}
.sc17-network-context>span{display:grid;gap:2px;min-width:0}.sc17-network-context>span>small{font-size:7px;font-weight:900;letter-spacing:.08em;color:#bfc3d8}.sc17-network-context>span>strong{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sc17-network-context>span>em{font-size:7px;font-style:normal;color:#aeb3cb;line-height:1.4}
.sc17-platform-fields{position:relative;padding:0!important;overflow:hidden}.sc17-settings-heading{padding:11px 13px;border-bottom:1px solid #ececf3;background:#fafafe;display:grid;gap:2px}.sc17-settings-heading>span{font-size:9px;font-weight:900;color:#14163a}.sc17-settings-heading>small{font-size:7px;color:#8a8ea2;line-height:1.4}.sc17-platform-fields>.sc4-destinations{padding:14px!important}
.sc17-platform-card{position:relative}.sc17-platform-card.sc17-youtube{box-shadow:inset 3px 0 0 rgba(232,43,222,.55)}.sc17-platform-card.sc17-instagram{box-shadow:inset 3px 0 0 rgba(138,54,245,.50)}.sc17-platform-card.sc17-tiktok{box-shadow:inset 3px 0 0 rgba(30,97,254,.48)}
.sc17-settings-intro{margin:0 0 12px;padding:10px 11px;border:1px solid #e6e4f4;border-radius:12px;background:#faf9ff;display:grid;gap:3px}.sc17-settings-intro small{font-size:7px;font-weight:900;letter-spacing:.07em;color:#7141d3}.sc17-settings-intro strong{font-size:10px;color:#14163a}.sc17-settings-intro span{font-size:7px;line-height:1.45;color:#85899d}

/* Explicit scheduling step */
.sc17-timing-section{margin-top:18px;padding:14px;border:1px solid #dfe1ec;border-radius:17px;background:#fff;box-shadow:0 7px 22px rgba(20,22,58,.045)}.sc17-timing-section>header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.sc17-timing-section>header>span{display:grid;gap:2px}.sc17-timing-section>header small{font-size:7px;font-weight:900;letter-spacing:.08em;color:#7141d3}.sc17-timing-section>header strong{font-size:13px;color:#14163a}.sc17-timing-section>header>svg{width:31px;height:31px;padding:8px;border-radius:10px;background:#f1edff;color:#6735d8}
.sc17-timing-mode{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}.sc17-timing-mode>button{min-height:54px;padding:9px 10px;border:1px solid #e1e3ec;border-radius:13px;background:#fff;color:#14163a;display:grid;grid-template-columns:25px 1fr;gap:8px;align-items:center;text-align:left;cursor:pointer}.sc17-timing-mode>button>svg{color:#777b91}.sc17-timing-mode>button>span{display:grid;gap:2px}.sc17-timing-mode strong{font-size:9px}.sc17-timing-mode small{font-size:7px;color:#9296a8}.sc17-timing-mode>button.active{border-color:#a99aef;background:#f5f1ff;box-shadow:inset 0 0 0 1px rgba(105,52,218,.08)}.sc17-timing-mode>button.active>svg{color:#6735d8}
.sc17-date-time-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}.sc17-date-time-fields label{display:grid;gap:5px}.sc17-date-time-fields label>span{font-size:8px;font-weight:850;color:#555a73}.sc17-date-time-fields input{width:100%;min-height:42px;border:1px solid #dfe1eb;border-radius:11px;background:#fff;padding:0 10px;color:#14163a;font:inherit;font-size:9px;outline:none}.sc17-date-time-fields input:focus{border-color:#9a85ec;box-shadow:0 0 0 3px rgba(138,54,245,.08)}
.sc17-timing-summary{display:grid;grid-template-columns:30px 1fr;gap:9px;align-items:center;padding:10px 11px;border-radius:12px;background:#f7f7fb}.sc17-timing-summary>svg{width:30px;height:30px;padding:8px;border-radius:9px;background:#fff;color:#6632d7}.sc17-timing-summary>span{display:grid;gap:2px}.sc17-timing-summary small{font-size:7px;color:#8f93a6}.sc17-timing-summary strong{font-size:9px;color:#14163a}.sc17-timing-summary em{font-size:7px;font-style:normal;color:#9a9dae}.sc17-timing-summary.invalid{background:#fff7e8}.sc17-timing-summary.invalid>svg{color:#a66b00}
.sc17-time-warning{margin-top:8px;padding:9px 10px;border-radius:11px;background:#fff4dd;color:#8e6207;display:flex;gap:7px;align-items:flex-start;font-size:7.5px;line-height:1.45}

/* Fix action layout regression caused by the generic .sc9-validate-card > div selector. */
.sc9-validate-card.sc17-final-actions{padding:13px!important}.sc9-validate-card.sc17-final-actions>.sc16-completion-warning{display:flex!important;grid-template-columns:none!important;gap:9px!important;align-items:flex-start!important;margin:0 0 10px!important;padding:10px 12px!important;border:0!important;border-radius:12px!important;background:#fff8e8!important}.sc9-validate-card.sc17-final-actions>.sc16-completion-warning>svg{width:14px!important;height:14px!important;padding:0!important;border-radius:0!important;background:transparent!important;color:#8b5f00!important}
.sc9-validate-card.sc17-final-actions>.sc16-compose-actions{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1.45fr)!important;gap:9px!important;margin:0!important;padding:0!important;border:0!important;align-items:stretch!important}.sc9-validate-card.sc17-final-actions>.sc16-compose-actions>.sc16-draft-button,.sc9-validate-card.sc17-final-actions>.sc16-compose-actions>.sc3-primary{width:100%!important;min-width:0!important;min-height:50px!important;margin:0!important;border-radius:13px!important;font-size:9px!important;line-height:1.15!important;white-space:normal!important}.sc9-validate-card.sc17-final-actions>.sc16-compose-actions>.sc16-draft-button{padding:0 12px!important}
.sc15-day-add:disabled{opacity:.22;cursor:not-allowed!important;background:transparent!important}

@media(max-width:760px){.sc17-timing-mode,.sc17-date-time-fields,.sc9-validate-card.sc17-final-actions>.sc16-compose-actions{grid-template-columns:1fr!important}.sc17-network-context{grid-template-columns:34px minmax(0,1fr)}.sc17-network-icon{width:34px;height:34px}}
`);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./composer-ux-guardrails.css")) {
  main += `\nimport './composer-ux-guardrails.css';\n`;
  fs.writeFileSync(mainPath, main);
}

console.log('Composer UX guardrails, scheduling constraints and network hierarchy applied.');
