import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('sc3-drop-network-prompt')) {
  console.log('Create-page library drag and drop already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Create library DnD patch failed: ${label} anchor not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce(
`}) {
  const selectedConnections = connections.filter((connection) => selectedIds.includes(connection.id));
  return (`,
`}) {
  const [destinationPromptOpen, setDestinationPromptOpen] = useState(false);
  const [mediaDropActive, setMediaDropActive] = useState(false);
  const hasDestination = selectedIds.length + plannedPlatforms.length > 0;

  function chooseLibraryMedia(item: MediaItem) {
    onSelectMedia(item.id);
    if (!body.trim() && item.caption) onBody(item.caption);
    setDestinationPromptOpen(true);
  }

  function handleMediaDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setMediaDropActive(false);
    const mediaId = event.dataTransfer.getData('application/x-social-library-media');
    const item = library.find((candidate) => candidate.id === mediaId);
    if (item) chooseLibraryMedia(item);
  }

  return (`,
  'create-page drop state',
);

replaceOnce(
`          <div className="sc3-media-section">
            <div className="sc3-section-title"><span><strong>Média</strong><small>Optionnel</small></span><div><button onClick={onUpload}><Upload size={14} /> Importer</button><button onClick={onOpenLibrary}><FolderOpen size={14} /> Bibliothèque</button></div></div>
            {selectedMedia ? (
              <div className="sc3-selected-media">
                <div>{selectedMedia.mimeType.startsWith('image/') ? <img src={selectedMedia.previewUrl} alt="" /> : <Video size={24} />}</div>
                <span><strong>{selectedMedia.title}</strong><small>{mediaFormatLabels[selectedMedia.format]} · {formatBytes(selectedMedia.sizeBytes)}</small></span>
                <button onClick={() => onSelectMedia(undefined)}><X size={15} /></button>
              </div>
            ) : (
              <div className="sc3-media-quick">
                {library.slice(0, 6).map((item) => <button key={item.id} onClick={() => { onSelectMedia(item.id); if (!body.trim() && item.caption) onBody(item.caption); }}>{item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt="" /> : <Video size={19} />}<span>{item.title}</span></button>)}
                {!library.length && <button className="empty" onClick={onUpload}><Plus size={18} /><span>Importer le premier média</span></button>}
              </div>
            )}
          </div>`,
`          <div className="sc3-media-section sc3-create-media-section">
            <div className="sc3-section-title"><span><strong>Contenu</strong><small>Glissez un élément de votre bibliothèque</small></span><div><button onClick={onUpload}><Upload size={14} /> Importer</button><button onClick={onOpenLibrary}><FolderOpen size={14} /> Gérer la bibliothèque</button></div></div>
            <div
              className={\`sc3-media-dropzone\${mediaDropActive ? ' is-over' : ''}\${selectedMedia ? ' has-media' : ''}\`}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setMediaDropActive(true); }}
              onDragLeave={() => setMediaDropActive(false)}
              onDrop={handleMediaDrop}
            >
              {selectedMedia ? (
                <div className="sc3-selected-media sc3-selected-media-large">
                  <div className={\`sc3-selected-media-preview sc3-selected-media-\${selectedMedia.format}\`}>{selectedMedia.mimeType.startsWith('image/') ? <img src={selectedMedia.previewUrl} alt="" /> : selectedMedia.mimeType.startsWith('video/') ? <video src={selectedMedia.previewUrl} muted playsInline preload="auto" onLoadedMetadata={(event) => primeVideoPreview(event.currentTarget)} /> : <Video size={24} />}</div>
                  <span><strong>{selectedMedia.title}</strong><small>{mediaFormatLabels[selectedMedia.format]} · {mediaFormatRatio(selectedMedia.format)} · {formatBytes(selectedMedia.sizeBytes)}</small><em>Déposez un autre contenu pour le remplacer</em></span>
                  <button onClick={() => onSelectMedia(undefined)} aria-label="Retirer le contenu"><X size={15} /></button>
                </div>
              ) : (
                <div className="sc3-media-drop-empty"><FolderOpen size={28} /><strong>Déposez votre contenu ici</strong><span>Image, Post, Reel, Short, Story ou vidéo</span></div>
              )}
            </div>
            <div className="sc3-create-library-tray">
              <header><span><strong>Bibliothèque</strong><small>Glissez un contenu dans la zone ci-dessus</small></span><b>{library.length}</b></header>
              <div className="sc3-create-library-items">
                {library.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    draggable
                    className={selectedMedia?.id === item.id ? 'active' : ''}
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-social-library-media', item.id); }}
                    onClick={() => chooseLibraryMedia(item)}
                    title={item.title}
                  >
                    <span className={\`sc3-create-library-thumb sc3-create-library-thumb-\${item.format}\`}>{item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt="" /> : item.mimeType.startsWith('video/') ? <video src={item.previewUrl} muted playsInline preload="metadata" onLoadedMetadata={(event) => primeVideoPreview(event.currentTarget)} /> : <Video size={19} />}</span>
                    <span><strong>{item.title}</strong><small>{mediaFormatLabels[item.format]} · {mediaFormatRatio(item.format)}</small></span>
                  </button>
                ))}
                {!library.length && <button type="button" className="empty" onClick={onUpload}><Plus size={18} /><span><strong>Importer le premier contenu</strong><small>Il apparaîtra ici immédiatement</small></span></button>}
              </div>
            </div>
          </div>`,
  'drag-and-drop media section',
);

replaceOnce(
`        </aside>
      </section>
    </div>
  );
}`,
`        </aside>
      </section>
      {destinationPromptOpen && (
        <div className="sc3-drop-network-prompt" onMouseDown={() => setDestinationPromptOpen(false)}>
          <section onMouseDown={(event) => event.stopPropagation()}>
            <header><div><small>Destination</small><h2>Où programmer ce contenu ?</h2><p>Sélectionnez un ou plusieurs comptes. Un réseau non connecté peut quand même être ajouté au Planner.</p></div><button type="button" onClick={() => setDestinationPromptOpen(false)} aria-label="Fermer"><X size={18} /></button></header>
            <div className="sc3-drop-network-grid">
              {(['instagram', 'youtube', 'tiktok'] as PlanningPlatform[]).map((platform) => {
                const platformConnections = connections.filter((connection) => connection.platform === platform);
                const planned = plannedPlatforms.includes(platform);
                return (
                  <div className="sc3-drop-network-card" key={platform}>
                    <div className="sc3-drop-network-title"><PlatformMark platform={platform} /><span><strong>{platformLabel(platform)}</strong><small>{platformConnections.length ? \`\${platformConnections.length} compte\${platformConnections.length > 1 ? 's' : ''}\` : 'Aucun compte connecté'}</small></span></div>
                    <div>
                      {platformConnections.map((connection) => <button type="button" key={connection.id} className={selectedIds.includes(connection.id) ? 'active' : ''} onClick={() => onToggle(connection.id)}><span><strong>{connection.displayName}</strong><small>{connection.handle || connection.status}</small></span>{selectedIds.includes(connection.id) ? <Check size={15} /> : <Plus size={15} />}</button>)}
                      {!platformConnections.length && <button type="button" className={planned ? 'active planned' : 'planned'} onClick={() => onTogglePlanned(platform)}><span><strong>{platformLabel(platform)}</strong><small>Planifier maintenant, connecter plus tard</small></span>{planned ? <Check size={15} /> : <Plus size={15} />}</button>}
                    </div>
                  </div>
                );
              })}
            </div>
            <footer><button type="button" className="sc3-secondary" onClick={() => setDestinationPromptOpen(false)}>Choisir plus tard</button><button type="button" className="sc3-primary" disabled={!hasDestination} onClick={() => setDestinationPromptOpen(false)}>Continuer avec {selectedIds.length + plannedPlatforms.length || 0} destination{selectedIds.length + plannedPlatforms.length > 1 ? 's' : ''}</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}`,
  'destination prompt after drop',
);

fs.writeFileSync(path, source);
console.log('Create-page library drag and drop applied.');
