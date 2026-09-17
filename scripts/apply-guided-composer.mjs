import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('sc9-guided-composer')) {
  console.log('Guided composer already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Guided composer patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

replaceOnce(
`    setPlannedPlatforms([]);
    setDestinationDrafts({});
    if (dateKey) setScheduleDate(dateKey);`,
`    setPlannedPlatforms([]);
    setDestinationDrafts({});
    setSelectedMediaId(undefined);
    setSelectedConnectionIds([]);
    if (dateKey) setScheduleDate(dateKey);`,
  'clear new publication choices',
);
source = source.replace(`    if (activeAccountId !== 'all') setSelectedConnectionIds([activeAccountId]);\n    navigate('create');`, `    navigate('create');`);

replaceOnce(
`function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {`,
`function guidedCompatiblePlatforms(format: MediaFormat): PlanningPlatform[] {
  if (format === 'story') return ['instagram'];
  if (format === 'post') return ['instagram', 'tiktok'];
  return ['instagram', 'youtube', 'tiktok'];
}

function guidedDefaultFormat(platform: PlanningPlatform, format: MediaFormat) {
  if (platform === 'instagram') return format === 'post' ? 'post' : format === 'story' ? 'story' : 'reel';
  if (platform === 'youtube') return format === 'short' ? 'short' : 'video';
  return format === 'post' ? 'photo' : 'video';
}

function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {`,
  'guided helpers',
);

replaceOnce(
`  const [destinationPromptOpen, setDestinationPromptOpen] = useState(false);
  const [mediaDropActive, setMediaDropActive] = useState(false);`,
`  const [destinationPromptOpen, setDestinationPromptOpen] = useState(false);
  const [mediaDropActive, setMediaDropActive] = useState(false);
  const [guidedStep, setGuidedStep] = useState<'media' | 'networks' | 'details'>('media');`,
  'guided state',
);

replaceOnce(
`  function chooseLibraryMedia(item: MediaItem) {
    onSelectMedia(item.id);
    if (!body.trim() && item.caption) onBody(item.caption);
    setDestinationPromptOpen(false);
  }`,
`  function chooseLibraryMedia(item: MediaItem) {
    onSelectMedia(item.id);
    if (!body.trim() && item.caption) onBody(item.caption);
    setDestinationPromptOpen(false);
    setGuidedStep('networks');
  }`,
  'advance after library choice',
);

replaceOnce(
`  const previewDestinations = destinationPayload(connections, selectedIds, plannedPlatforms, destinationDrafts);
  useEffect(() => { setDeliveryOpen(!editingPublication); }, [editingPublication?.id]);`,
`  const previewDestinations = destinationPayload(connections, selectedIds, plannedPlatforms, destinationDrafts);
  useEffect(() => { setDeliveryOpen(!editingPublication); }, [editingPublication?.id]);
  useEffect(() => {
    if (editingPublication) return;
    if (!selectedMedia) setGuidedStep('media');
    else if (guidedStep === 'media') setGuidedStep('networks');
  }, [editingPublication?.id, selectedMedia?.id]);`,
  'advance after import',
);

const returnAnchor = `  return (\n    <div className={\`sc3-create-page \${editingPublication ? 'sc7-edit-mode' : 'sc7-add-mode'}\`}>`;
if (!source.includes(returnAnchor)) throw new Error('Guided composer patch failed: main return anchor not found.');

const guidedReturn = `  if (!editingPublication) {
    const compatiblePlatforms = selectedMedia ? guidedCompatiblePlatforms(selectedMedia.format) : [];
    const selectedCount = selectedIds.length + plannedPlatforms.length;

    function toggleGuidedConnection(connection: LiveConnection) {
      const selecting = !selectedIds.includes(connection.id);
      onToggle(connection.id);
      if (selecting && selectedMedia) {
        onDestinationDraft(connectionDestinationKey(connection.id), makeDestinationDraft(connection.platform as PlanningPlatform, {
          connectionId: connection.id,
          accountLabel: connection.displayName,
          accountHandle: connection.handle,
          format: guidedDefaultFormat(connection.platform as PlanningPlatform, selectedMedia.format),
        }));
      }
    }

    function toggleGuidedPlatform(platform: PlanningPlatform) {
      const selecting = !plannedPlatforms.includes(platform);
      onTogglePlanned(platform);
      if (selecting && selectedMedia) {
        onDestinationDraft(plannedDestinationKey(platform), makeDestinationDraft(platform, {
          accountLabel: platformLabel(platform),
          format: guidedDefaultFormat(platform, selectedMedia.format),
        }));
      }
    }

    return (
      <div className="sc3-create-page sc9-guided-composer">
        <header className="sc9-guided-head">
          <button type="button" onClick={onBack} aria-label="Fermer"><X size={18} /></button>
          <div><small>Nouvelle publication</small><strong>{scheduleLabel}</strong></div>
          <span className="sc9-step-counter">{guidedStep === 'media' ? '1' : guidedStep === 'networks' ? '2' : '3'} / 3</span>
        </header>
        <div className="sc9-progress" aria-hidden="true"><span className={guidedStep === 'media' ? 'one' : guidedStep === 'networks' ? 'two' : 'three'} /></div>

        {guidedStep === 'media' && (
          <section className="sc9-step sc9-step-media">
            <div className="sc9-question"><small>Étape 1</small><h2>Quel contenu voulez-vous publier ?</h2><p>Choisissez un contenu de votre bibliothèque ou importez-en un nouveau.</p></div>
            <button type="button" className="sc9-import" onClick={onUpload}><Upload size={18} /><span><strong>Importer un nouveau contenu</strong><small>Image, Reel, Short, Story ou vidéo</small></span><ChevronRight size={17} /></button>
            <div className="sc9-library-label"><strong>Bibliothèque</strong><small>{library.length} contenu{library.length > 1 ? 's' : ''}</small></div>
            <div className="sc9-library-grid">
              {library.map((item) => (
                <button type="button" key={item.id} onClick={() => chooseLibraryMedia(item)}>
                  <span className={\`sc9-media-thumb sc9-media-\${item.format}\`}>{item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt="" /> : <video src={item.previewUrl} muted playsInline preload="metadata" onLoadedMetadata={(event) => primeVideoPreview(event.currentTarget)} />}</span>
                  <span><strong>{item.title}</strong><small>{mediaFormatLabels[item.format]} · {mediaFormatRatio(item.format)}</small></span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {!library.length && <div className="sc9-empty-library"><FolderOpen size={26} /><strong>Votre bibliothèque est vide</strong><small>Importez votre premier contenu pour continuer.</small></div>}
            </div>
          </section>
        )}

        {guidedStep === 'networks' && selectedMedia && (
          <section className="sc9-step sc9-step-networks">
            <button type="button" className="sc9-back-link" onClick={() => setGuidedStep('media')}><ChevronLeft size={15} /> Changer de contenu</button>
            <div className="sc9-selected-media"><span className={\`sc9-media-thumb sc9-media-\${selectedMedia.format}\`}>{selectedMedia.mimeType.startsWith('image/') ? <img src={selectedMedia.previewUrl} alt="" /> : <video src={selectedMedia.previewUrl} muted playsInline preload="metadata" onLoadedMetadata={(event) => primeVideoPreview(event.currentTarget)} />}</span><span><strong>{selectedMedia.title}</strong><small>{mediaFormatLabels[selectedMedia.format]}</small></span></div>
            <div className="sc9-question"><small>Étape 2</small><h2>Où voulez-vous le publier ?</h2><p>Seuls les réseaux compatibles avec ce contenu sont proposés.</p></div>
            <div className="sc9-network-list">
              {compatiblePlatforms.map((platform) => {
                const platformConnections = connections.filter((connection) => connection.platform === platform);
                const planned = plannedPlatforms.includes(platform);
                return (
                  <article key={platform} className="sc9-network-card">
                    <header><PlatformMark platform={platform} size={17} /><span><strong>{platformLabel(platform)}</strong><small>{guidedDefaultFormat(platform, selectedMedia.format)}</small></span></header>
                    <div>
                      {platformConnections.map((connection) => {
                        const active = selectedIds.includes(connection.id);
                        return <button type="button" key={connection.id} className={active ? 'active' : ''} onClick={() => toggleGuidedConnection(connection)}><span><strong>{connection.displayName}</strong><small>{connection.handle || (connection.status === 'connected' ? 'Connecté' : 'À connecter')}</small></span>{active ? <Check size={16} /> : <Plus size={16} />}</button>;
                      })}
                      {!platformConnections.length && <button type="button" className={planned ? 'active' : ''} onClick={() => toggleGuidedPlatform(platform)}><span><strong>Ajouter {platformLabel(platform)}</strong><small>Le compte pourra être connecté plus tard</small></span>{planned ? <Check size={16} /> : <Plus size={16} />}</button>}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="sc9-sticky-action"><button type="button" className="sc3-primary wide" disabled={!selectedCount} onClick={() => { setPreviewIndex(0); setGuidedStep('details'); }}>Continuer avec {selectedCount || 0} réseau{selectedCount > 1 ? 'x' : ''} <ChevronRight size={16} /></button></div>
          </section>
        )}

        {guidedStep === 'details' && selectedMedia && (
          <section className="sc9-step sc9-step-details">
            <button type="button" className="sc9-back-link" onClick={() => setGuidedStep('networks')}><ChevronLeft size={15} /> Modifier les réseaux</button>
            <div className="sc9-question"><small>Étape 3</small><h2>Ajoutez les informations de la publication</h2><p>Les champs affichés correspondent uniquement au réseau sélectionné.</p></div>
            {previewDestinations.length > 1 && <div className="sc9-network-tabs">{previewDestinations.map((destination, index) => <button type="button" key={\`\${destination.platform}-\${destination.accountLabel}-\${index}\`} className={previewIndex === index ? 'active' : ''} onClick={() => setPreviewIndex(index)}><PlatformMark platform={destination.platform} size={13} /> {platformLabel(destination.platform)}</button>)}</div>}
            {activePreviewDestination && <div className="sc9-active-network"><PlatformMark platform={activePreviewDestination.platform} size={17} /><span><strong>{activePreviewDestination.accountLabel}</strong><small>{platformLabel(activePreviewDestination.platform)} · {activePreviewDestination.format}</small></span></div>}
            <div className="sc9-fields">
              <PlatformDestinationEditor
                mode="content"
                mediaFormat={selectedMedia.format}
                activeIndex={previewIndex}
                connections={connections}
                selectedConnectionIds={selectedIds}
                plannedPlatforms={plannedPlatforms}
                drafts={destinationDrafts}
                onToggleConnection={onToggle}
                onTogglePlanned={onTogglePlanned}
                onDraft={onDestinationDraft}
              />
            </div>
            <div className="sc9-validate-card"><div><CalendarDays size={16} /><span><small>Programmée pour</small><strong>{scheduleLabel}</strong></span></div><button type="button" className="sc3-primary wide" disabled={busy || incompatibleDestinations.length > 0 || !selectedCount} onClick={onSchedule}>{busy ? 'Enregistrement…' : 'Valider la publication'} <Check size={16} /></button></div>
          </section>
        )}
      </div>
    );
  }

` + returnAnchor;
source = source.replace(returnAnchor, guidedReturn);

replaceOnce(
`        <label>Titre<input value={draft.title} disabled={busy} onChange={(event) => onChange({ ...draft, title: event.target.value })} maxLength={180} /></label>
        <label>Légende par défaut <span>(optionnel)</span><textarea value={draft.caption} disabled={busy} onChange={(event) => onChange({ ...draft, caption: event.target.value })} maxLength={5000} /></label>`,
`        {draft.returnTo !== 'create' && <label>Titre<input value={draft.title} disabled={busy} onChange={(event) => onChange({ ...draft, title: event.target.value })} maxLength={180} /></label>}
        {draft.returnTo !== 'create' && <label>Légende par défaut <span>(optionnel)</span><textarea value={draft.caption} disabled={busy} onChange={(event) => onChange({ ...draft, caption: event.target.value })} maxLength={5000} /></label>}`,
  'simplify create upload dialog',
);
replaceOnce(
`<button className="sc3-primary wide" disabled={busy || !draft.title.trim()} onClick={onUpload}>{busy ? 'Import en cours…' : 'Ajouter à la bibliothèque'}</button>`,
`<button className="sc3-primary wide" disabled={busy || !draft.title.trim()} onClick={onUpload}>{busy ? 'Import en cours…' : draft.returnTo === 'create' ? 'Importer et continuer' : 'Ajouter à la bibliothèque'}</button>`,
  'upload continue label',
);

fs.writeFileSync(path, source);
console.log('Guided three-step composer applied.');
