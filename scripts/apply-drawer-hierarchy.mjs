import fs from 'node:fs';

const appPath = 'src/LiveAppV3.tsx';
const editorPath = 'src/PlatformDestinationEditor.tsx';
let app = fs.readFileSync(appPath, 'utf8');
let editor = fs.readFileSync(editorPath, 'utf8');

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Drawer hierarchy patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

if (!editor.includes('isSocialFormatCompatible')) {
  editor = replaceOnce(
    editor,
    `export default function PlatformDestinationEditor({`,
    `const editorialFieldKeys = new Set(['caption', 'altText', 'note', 'title', 'description', 'tags']);\n\nfunction isEditorialField(definition: PublicationFieldDefinition) {\n  return editorialFieldKeys.has(definition.key);\n}\n\nexport function isSocialFormatCompatible(platform: PlanningPlatform, format: string, mediaFormat?: 'post' | 'short' | 'video' | 'story') {\n  if (!mediaFormat) return true;\n  if (mediaFormat === 'story') return platform === 'instagram' && format === 'story';\n  if (mediaFormat === 'post') return (platform === 'instagram' && (format === 'post' || format === 'carousel')) || (platform === 'tiktok' && format === 'photo');\n  if (mediaFormat === 'short') return (platform === 'instagram' && format === 'reel') || (platform === 'youtube' && format === 'short') || (platform === 'tiktok' && format === 'video');\n  if (mediaFormat === 'video') return (platform === 'youtube' && format === 'video') || (platform === 'instagram' && format === 'reel') || (platform === 'tiktok' && format === 'video');\n  return true;\n}\n\nexport default function PlatformDestinationEditor({`,
    'editor helpers',
  );

  editor = replaceOnce(
    editor,
    `  onDraft,\n}: {`,
    `  onDraft,\n  mode = 'all',\n  mediaFormat,\n}: {`,
    'editor mode args',
  );

  editor = replaceOnce(
    editor,
    `  onDraft: (key: string, draft: DestinationDraft) => void;\n}) {`,
    `  onDraft: (key: string, draft: DestinationDraft) => void;\n  mode?: 'all' | 'content' | 'delivery';\n  mediaFormat?: 'post' | 'short' | 'video' | 'story';\n}) {`,
    'editor mode props',
  );

  editor = replaceOnce(
    editor,
    `<section className="sc4-destinations">`,
    `<section className={\`sc4-destinations sc7-mode-\${mode}\`}>`,
    'editor mode class',
  );

  editor = replaceOnce(
    editor,
    `{schema.formats.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}`,
    `{schema.formats.map((format) => <option key={format.id} value={format.id} disabled={Boolean(mediaFormat && !isSocialFormatCompatible(draft.platform, format.id, mediaFormat))}>{format.label}</option>)}`,
    'compatible format options',
  );

  editor = replaceOnce(
    editor,
    `<small>{formatDefinition.mediaHint}</small>`,
    `<small>{formatDefinition.mediaHint}</small>\n                  {mediaFormat && !isSocialFormatCompatible(draft.platform, draft.format, mediaFormat) && <small className="sc7-compat-warning">Ce format n’est pas compatible avec le contenu sélectionné. Choisissez un format disponible.</small>}`,
    'compatibility warning',
  );

  editor = replaceOnce(
    editor,
    `{formatDefinition.fields.map((field) => (`,
    `{formatDefinition.fields.filter((field) => mode === 'all' ? true : mode === 'content' ? isEditorialField(field) : !isEditorialField(field)).map((field) => (`,
    'field grouping',
  );

  fs.writeFileSync(editorPath, editor);
}

if (!app.includes('sc7-drawer-summary')) {
  app = replaceOnce(
    app,
    `import PlatformDestinationEditor, { connectionDestinationKey, destinationPayload, makeDestinationDraft, plannedDestinationKey, type DestinationDraft } from './PlatformDestinationEditor';`,
    `import PlatformDestinationEditor, { connectionDestinationKey, destinationPayload, isSocialFormatCompatible, makeDestinationDraft, plannedDestinationKey, type DestinationDraft } from './PlatformDestinationEditor';`,
    'compatibility import',
  );

  app = replaceOnce(
    app,
    `  const previewDestinations = destinationPayload(connections, selectedIds, plannedPlatforms, destinationDrafts);`,
    `  const previewDestinations = destinationPayload(connections, selectedIds, plannedPlatforms, destinationDrafts);\n  const incompatibleDestinations = selectedMedia ? previewDestinations.filter((destination) => !isSocialFormatCompatible(destination.platform, destination.format, selectedMedia.format)) : [];\n  const scheduleLabel = publishNow\n    ? 'Dès que possible'\n    : new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(\`\${scheduleDate}T\${scheduleTime}:00\`));`,
    'drawer summary state',
  );

  app = replaceOnce(
    app,
    `<div className="sc3-create-page">`,
    `<div className={\`sc3-create-page \${editingPublication ? 'sc7-edit-mode' : 'sc7-add-mode'}\`}>`,
    'drawer mode class',
  );

  app = replaceOnce(
    app,
    `<label className="sc3-caption-field"><span>Texte</span><textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder="Écrivez votre publication…" maxLength={5000} /></label>`,
    `{!previewDestinations.length && <label className="sc3-caption-field"><span>Texte de préparation</span><textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder="Ajoutez d’abord une destination pour obtenir les champs adaptés au réseau…" maxLength={5000} /></label>}`,
    'hide generic text when networks selected',
  );

  app = replaceOnce(
    app,
    `<div className="sc3-media-section sc3-create-media-section">`,
    `<div className={\`sc3-media-section sc3-create-media-section\${editingPublication ? ' sc7-editing-media' : ''}\`}>`,
    'compact edit media',
  );

  app = app.replace('setDestinationPromptOpen(true);', 'setDestinationPromptOpen(false);');

  app = replaceOnce(
    app,
    `      <PlannerComposerPreview\n        destinations={previewDestinations}\n        activeIndex={previewIndex}\n        onActiveIndex={setPreviewIndex}\n        media={selectedMedia}\n        fallbackText={body}\n      />`,
    `      <section className="sc7-drawer-summary">\n        <div className="sc7-step-heading"><b>1</b><span><strong>Où et quand ?</strong><small>La diffusion prévue, en un coup d’œil.</small></span></div>\n        <div className="sc7-summary-row">\n          <div className="sc7-summary-targets">\n            {previewDestinations.length ? previewDestinations.map((destination, index) => (\n              <span key={\`\${destination.platform}-\${destination.accountLabel}-\${index}\`}><PlatformMark platform={destination.platform} size={12} /><strong>{destination.accountLabel}</strong></span>\n            )) : <span className="empty"><Plus size={12} /> Aucune destination</span>}\n          </div>\n          <div className="sc7-summary-time"><CalendarDays size={14} /><strong>{scheduleLabel}</strong></div>\n        </div>\n      </section>\n      <section className="sc7-preview-block">\n        <div className="sc7-step-heading"><b>2</b><span><strong>Aperçu de la publication</strong><small>Ce que verra votre audience.</small></span></div>\n        <PlannerComposerPreview\n          destinations={previewDestinations}\n          activeIndex={previewIndex}\n          onActiveIndex={setPreviewIndex}\n          media={selectedMedia}\n          fallbackText={body}\n        />\n      </section>`,
    'summary and preview hierarchy',
  );

  app = replaceOnce(
    app,
    `          <PlatformDestinationEditor\n            connections={connections}\n            selectedConnectionIds={selectedIds}\n            plannedPlatforms={plannedPlatforms}\n            drafts={destinationDrafts}\n            onToggleConnection={onToggle}\n            onTogglePlanned={onTogglePlanned}\n            onDraft={onDestinationDraft}\n          />`,
    `          <section className="sc7-editor-block sc7-content-block">\n            <div className="sc7-step-heading"><b>3</b><span><strong>Contenu</strong><small>Modifiez uniquement les textes réellement utilisés par chaque réseau.</small></span></div>\n            {previewDestinations.length ? (\n              <PlatformDestinationEditor\n                mode="content"\n                mediaFormat={selectedMedia?.format}\n                connections={connections}\n                selectedConnectionIds={selectedIds}\n                plannedPlatforms={plannedPlatforms}\n                drafts={destinationDrafts}\n                onToggleConnection={onToggle}\n                onTogglePlanned={onTogglePlanned}\n                onDraft={onDestinationDraft}\n              />\n            ) : <p className="sc7-block-empty">Choisissez d’abord au moins une destination dans le bloc Diffusion.</p>}\n          </section>\n          <section className="sc7-editor-block sc7-delivery-block">\n            <div className="sc7-step-heading"><b>4</b><span><strong>Modifier la diffusion</strong><small>Comptes, formats et options compatibles.</small></span></div>\n            <PlatformDestinationEditor\n              mode="delivery"\n              mediaFormat={selectedMedia?.format}\n              connections={connections}\n              selectedConnectionIds={selectedIds}\n              plannedPlatforms={plannedPlatforms}\n              drafts={destinationDrafts}\n              onToggleConnection={onToggle}\n              onTogglePlanned={onTogglePlanned}\n              onDraft={onDestinationDraft}\n            />\n            {incompatibleDestinations.length > 0 && <div className="sc7-incompatible"><AlertTriangle size={14} /><span><strong>Format incompatible</strong><small>Changez le format ou le média avant d’enregistrer.</small></span></div>}\n          </section>`,
    'split content and delivery sections',
  );

  app = replaceOnce(
    app,
    `<h3>Programmation</h3>`,
    `<h3>Quand publier ?</h3><small className="sc7-schedule-help">Modifiez la date et l’heure si nécessaire.</small>`,
    'schedule hierarchy',
  );

  app = replaceOnce(
    app,
    `<button className="sc3-primary wide" disabled={busy || (!selectedIds.length && !plannedPlatforms.length)} onClick={onSchedule}>`,
    `<button className="sc3-primary wide" disabled={busy || (!selectedIds.length && !plannedPlatforms.length) || incompatibleDestinations.length > 0} onClick={onSchedule}>`,
    'block incompatible save',
  );

  fs.writeFileSync(appPath, app);
}

console.log('Drawer hierarchy, editorial grouping and media compatibility applied.');
