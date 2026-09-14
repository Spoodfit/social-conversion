import fs from 'node:fs';

const appPath = 'src/LiveAppV3.tsx';
const editorPath = 'src/PlatformDestinationEditor.tsx';
let app = fs.readFileSync(appPath, 'utf8');
let editor = fs.readFileSync(editorPath, 'utf8');

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Drawer v2 patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

if (!editor.includes('sc8-active-content-network')) {
  editor = replaceOnce(
    editor,
    `  mode = 'all',\n  mediaFormat,\n}: {`,
    `  mode = 'all',\n  mediaFormat,\n  activeIndex,\n}: {`,
    'editor active index argument',
  );
  editor = replaceOnce(
    editor,
    `  mode?: 'all' | 'content' | 'delivery';\n  mediaFormat?: 'post' | 'short' | 'video' | 'story';\n}) {`,
    `  mode?: 'all' | 'content' | 'delivery';\n  mediaFormat?: 'post' | 'short' | 'video' | 'story';\n  activeIndex?: number;\n}) {`,
    'editor active index type',
  );
  editor = replaceOnce(
    editor,
    `  for (const platform of plannedPlatforms) {\n    const key = plannedDestinationKey(platform);\n    selected.push(drafts[key] ?? makeDestinationDraft(platform));\n  }\n\n  return (`,
    `  for (const platform of plannedPlatforms) {\n    const key = plannedDestinationKey(platform);\n    selected.push(drafts[key] ?? makeDestinationDraft(platform));\n  }\n  const displayedDestinations = mode === 'content' && typeof activeIndex === 'number' && selected.length\n    ? [selected[Math.min(Math.max(activeIndex, 0), selected.length - 1)]!]\n    : selected;\n\n  return (`,
    'editor displayed destinations',
  );
  editor = replaceOnce(
    editor,
    `{selected.map((draft) => {`,
    `{displayedDestinations.map((draft) => {`,
    'single active content editor',
  );
  editor = editor.replace(
    `<div className="sc4-network-forms">`,
    `<div className={\`sc4-network-forms\${mode === 'content' ? ' sc8-active-content-network' : ''}\`}>`,
  );
  fs.writeFileSync(editorPath, editor);
}

if (!app.includes('sc8-publish-hero')) {
  app = replaceOnce(
    app,
    `  const [previewIndex, setPreviewIndex] = useState(0);\n  const hasDestination = selectedIds.length + plannedPlatforms.length > 0;`,
    `  const [previewIndex, setPreviewIndex] = useState(0);\n  const [deliveryOpen, setDeliveryOpen] = useState(!editingPublication);\n  const hasDestination = selectedIds.length + plannedPlatforms.length > 0;`,
    'delivery open state',
  );
  app = replaceOnce(
    app,
    `  const previewDestinations = destinationPayload(connections, selectedIds, plannedPlatforms, destinationDrafts);`,
    `  const previewDestinations = destinationPayload(connections, selectedIds, plannedPlatforms, destinationDrafts);\n  useEffect(() => { setDeliveryOpen(!editingPublication); }, [editingPublication?.id]);`,
    'delivery state reset',
  );
  app = replaceOnce(
    app,
    `  const scheduleLabel = publishNow\n    ? 'Dès que possible'\n    : new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(\`\${scheduleDate}T\${scheduleTime}:00\`));`,
    `  const scheduleLabel = publishNow\n    ? 'Dès que possible'\n    : new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(\`\${scheduleDate}T\${scheduleTime}:00\`));\n  const activePreviewDestination = previewDestinations[Math.min(Math.max(previewIndex, 0), Math.max(0, previewDestinations.length - 1))];\n  function openDeliveryOptions() {\n    setDeliveryOpen(true);\n    window.setTimeout(() => document.getElementById('sc8-delivery-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);\n  }`,
    'delivery helper',
  );

  const oldSummary = `      <section className="sc7-drawer-summary">\n        <div className="sc7-step-heading"><b>1</b><span><strong>Où et quand ?</strong><small>La diffusion prévue, en un coup d’œil.</small></span></div>\n        <div className="sc7-summary-row">\n          <div className="sc7-summary-targets">\n            {previewDestinations.length ? previewDestinations.map((destination, index) => (\n              <span key={\`\${destination.platform}-\${destination.accountLabel}-\${index}\`}><PlatformMark platform={destination.platform} size={12} /><strong>{destination.accountLabel}</strong></span>\n            )) : <span className="empty"><Plus size={12} /> Aucune destination</span>}\n          </div>\n          <div className="sc7-summary-time"><CalendarDays size={14} /><strong>{scheduleLabel}</strong></div>\n        </div>\n      </section>\n      <section className="sc7-preview-block">\n        <div className="sc7-step-heading"><b>2</b><span><strong>Aperçu de la publication</strong><small>Ce que verra votre audience.</small></span></div>\n        <PlannerComposerPreview\n          destinations={previewDestinations}\n          activeIndex={previewIndex}\n          onActiveIndex={setPreviewIndex}\n          media={selectedMedia}\n          fallbackText={body}\n        />\n      </section>`;

  const newSummary = `      <section className="sc8-publish-hero">\n        <div className="sc8-hero-top">\n          <span className="sc8-status-dot"><i /> {editingPublication ? 'Publication planifiée' : 'Nouvelle publication'}</span>\n          <button type="button" onClick={openDeliveryOptions}><Pencil size={12} /> Modifier la diffusion</button>\n        </div>\n        <div className="sc8-hero-time">\n          <CalendarDays size={20} />\n          <div><small>Publication prévue</small><strong>{scheduleLabel}</strong></div>\n        </div>\n        <div className="sc8-hero-destinations">\n          <small>Sur</small>\n          <div>{previewDestinations.length ? previewDestinations.map((destination, index) => (\n            <span key={\`\${destination.platform}-\${destination.accountLabel}-\${index}\`}><PlatformMark platform={destination.platform} size={12} /><strong>{destination.accountLabel}</strong></span>\n          )) : <button type="button" onClick={openDeliveryOptions}><Plus size={12} /> Choisir les réseaux</button>}</div>\n        </div>\n      </section>\n      <section className="sc8-preview-section">\n        <header className="sc8-section-title"><div><small>Aperçu</small><strong>Ce que votre audience verra</strong></div>{activePreviewDestination && <span>{platformLabel(activePreviewDestination.platform)}</span>}</header>\n        <PlannerComposerPreview\n          destinations={previewDestinations}\n          activeIndex={previewIndex}\n          onActiveIndex={setPreviewIndex}\n          media={selectedMedia}\n          fallbackText={body}\n        />\n      </section>`;
  app = replaceOnce(app, oldSummary, newSummary, 'hero summary and preview');

  app = replaceOnce(
    app,
    `<section className="sc7-editor-block sc7-content-block">\n            <div className="sc7-step-heading"><b>3</b><span><strong>Contenu</strong><small>Modifiez uniquement les textes réellement utilisés par chaque réseau.</small></span></div>`,
    `<section className="sc7-editor-block sc7-content-block sc8-content-block">\n            <header className="sc8-section-title"><div><small>Contenu</small><strong>Texte de la publication</strong></div>{activePreviewDestination && <span>{activePreviewDestination.accountLabel}</span>}</header>`,
    'content block header',
  );
  app = replaceOnce(
    app,
    `                mode="content"\n                mediaFormat={selectedMedia?.format}`,
    `                mode="content"\n                mediaFormat={selectedMedia?.format}\n                activeIndex={previewIndex}`,
    'active content editor',
  );

  const oldDelivery = `<section className="sc7-editor-block sc7-delivery-block">\n            <div className="sc7-step-heading"><b>4</b><span><strong>Modifier la diffusion</strong><small>Comptes, formats et options compatibles.</small></span></div>\n            <PlatformDestinationEditor\n              mode="delivery"\n              mediaFormat={selectedMedia?.format}\n              connections={connections}\n              selectedConnectionIds={selectedIds}\n              plannedPlatforms={plannedPlatforms}\n              drafts={destinationDrafts}\n              onToggleConnection={onToggle}\n              onTogglePlanned={onTogglePlanned}\n              onDraft={onDestinationDraft}\n            />\n            {incompatibleDestinations.length > 0 && <div className="sc7-incompatible"><AlertTriangle size={14} /><span><strong>Format incompatible</strong><small>Changez le format ou le média avant d’enregistrer.</small></span></div>}\n          </section>`;
  const newDelivery = `<details id="sc8-delivery-details" className="sc8-delivery-details" open={deliveryOpen || incompatibleDestinations.length > 0} onToggle={(event) => setDeliveryOpen(event.currentTarget.open)}>\n            <summary>\n              <span className="sc8-summary-icon"><Settings2 size={16} /></span>\n              <span><strong>Diffusion et horaire</strong><small>{previewDestinations.length ? \`\${previewDestinations.length} destination\${previewDestinations.length > 1 ? 's' : ''} · \${scheduleLabel}\` : 'Choisir les réseaux et la date'}</small></span>\n              <ChevronDown size={17} />\n            </summary>\n            <div className="sc8-delivery-body">\n              <PlatformDestinationEditor\n                mode="delivery"\n                mediaFormat={selectedMedia?.format}\n                connections={connections}\n                selectedConnectionIds={selectedIds}\n                plannedPlatforms={plannedPlatforms}\n                drafts={destinationDrafts}\n                onToggleConnection={onToggle}\n                onTogglePlanned={onTogglePlanned}\n                onDraft={onDestinationDraft}\n              />\n              {incompatibleDestinations.length > 0 && <div className="sc7-incompatible"><AlertTriangle size={14} /><span><strong>Format incompatible</strong><small>Changez le format ou le média avant d’enregistrer.</small></span></div>}\n            </div>\n          </details>`;
  app = replaceOnce(app, oldDelivery, newDelivery, 'collapsible delivery block');

  fs.writeFileSync(appPath, app);
}

console.log('Drawer v2 visual hierarchy applied.');
