import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('sc6-composer-drawer')) {
  console.log('Planner composer drawer already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Planner drawer patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

replaceOnce(
  "import PlatformDestinationEditor, { connectionDestinationKey, destinationPayload, makeDestinationDraft, plannedDestinationKey, type DestinationDraft } from './PlatformDestinationEditor';\n",
  "import PlatformDestinationEditor, { connectionDestinationKey, destinationPayload, makeDestinationDraft, plannedDestinationKey, type DestinationDraft } from './PlatformDestinationEditor';\nimport PlannerComposerPreview from './PlannerComposerPreview';\n",
  'preview import',
);

replaceOnce(
  '<div className="sc3-shell">',
  "<div className={`sc3-shell${page === 'create' ? ' sc6-drawer-open' : ''}`}>",
  'drawer root state',
);

replaceOnce(
  "{page === 'planner' && (",
  "{(page === 'planner' || page === 'create') && (",
  'keep planner visible',
);

replaceOnce(
  "page === 'create' ? (editingPublication ? 'Modifier la publication' : 'Nouvelle publication')",
  "page === 'create' ? 'Planner'",
  'topbar stays planner',
);

replaceOnce(
`          {page === 'create' && (\n            <CreatePage`,
`          {page === 'create' && (\n            <aside className="sc6-composer-drawer" aria-label={editingPublication ? 'Modifier la publication' : 'Nouvelle publication'}>\n              <CreatePage`,
  'open drawer',
);

replaceOnce(
`              onCancel={() => void cancelEditingPublication()}\n            />\n          )}\n\n          {page === 'settings' && (`,
`              onCancel={() => void cancelEditingPublication()}\n              />\n            </aside>\n          )}\n\n          {page === 'settings' && (`,
  'close drawer',
);

replaceOnce(
`  const [destinationPromptOpen, setDestinationPromptOpen] = useState(false);\n  const [mediaDropActive, setMediaDropActive] = useState(false);\n  const hasDestination = selectedIds.length + plannedPlatforms.length > 0;`,
`  const [destinationPromptOpen, setDestinationPromptOpen] = useState(false);\n  const [mediaDropActive, setMediaDropActive] = useState(false);\n  const [previewIndex, setPreviewIndex] = useState(0);\n  const hasDestination = selectedIds.length + plannedPlatforms.length > 0;\n  const previewDestinations = destinationPayload(connections, selectedIds, plannedPlatforms, destinationDrafts);`,
  'preview state',
);

replaceOnce(
`      <div className="sc3-page-head compact"><div><h1>{editingPublication ? 'Modifier la publication' : 'Nouvelle publication'}</h1><p>{editingPublication ? 'Modifiez sans supprimer la programmation existante.' : 'Contenu → comptes → date. Rien de plus.'}</p></div><button className="sc3-secondary" onClick={onBack}><ChevronLeft size={15} /> Retour au Planner</button></div>\n      <section className="sc3-compose-card">`,
`      <div className="sc3-page-head compact"><div><h1>{editingPublication ? 'Modifier' : 'Ajouter un contenu'}</h1><p>{editingPublication ? 'Le Planner reste visible pendant vos modifications.' : 'Bibliothèque → réseaux → programmation.'}</p></div><button className="sc3-secondary" onClick={onBack}><X size={15} /> Fermer</button></div>\n      <PlannerComposerPreview\n        destinations={previewDestinations}\n        activeIndex={previewIndex}\n        onActiveIndex={setPreviewIndex}\n        media={selectedMedia}\n        fallbackText={body}\n      />\n      <section className="sc3-compose-card">`,
  'final content preview',
);

replaceOnce(
`  const scrollRef = useRef<HTMLDivElement>(null);\n  const [hoverSlot, setHoverSlot] = useState<{ dateKey: string; minutes: number; top: number }>();`,
`  const scrollRef = useRef<HTMLDivElement>(null);\n  const [hoverSlot, setHoverSlot] = useState<{ dateKey: string; minutes: number; top: number }>();\n  const [expandedSlot, setExpandedSlot] = useState<string>();`,
  'stack expansion state',
);

source = source.replaceAll("target.closest('.sc3-agenda-card')", "target.closest('.sc3-agenda-card, .sc6-slot-stack')");

const startMarker = '                    {items.map((publication, index) => {';
const endMarker = '                    })}\n                  </section>';
const start = source.indexOf(startMarker);
if (start < 0) throw new Error('Planner drawer patch failed: planner item map start not found.');
const end = source.indexOf(endMarker, start);
if (end < 0) throw new Error('Planner drawer patch failed: planner item map end not found.');

const replacement = `                    {Array.from(items.reduce((map, publication) => {\n                      const date = new Date(publication.scheduledAt);\n                      const minutes = date.getHours() * 60 + date.getMinutes();\n                      const slotKey = String(minutes);\n                      map.set(slotKey, [...(map.get(slotKey) ?? []), publication]);\n                      return map;\n                    }, new Map<string, Publication[]>()).entries()).map(([slotKey, slotItems]) => {\n                      const publication = slotItems[0];\n                      if (!publication) return null;\n                      const date = new Date(publication.scheduledAt);\n                      const minutes = date.getHours() * 60 + date.getMinutes();\n                      const top = (minutes / 60) * SLOT_HEIGHT;\n                      const slotId = \`\${key}:\${slotKey}\`;\n\n                      if (slotItems.length > 1) {\n                        const expanded = expandedSlot === slotId;\n                        const platforms = [...new Set(slotItems.flatMap((item) => item.targets.map((target) => target.platform)))];\n                        return (\n                          <div key={slotId} className={\`sc6-slot-stack\${expanded ? ' expanded' : ''}\`} style={{ top }} onClick={(event) => event.stopPropagation()}>\n                            <button type="button" className="sc6-stack-summary" onClick={() => setExpandedSlot(expanded ? undefined : slotId)}>\n                              <time>{formatTime(publication.scheduledAt)}</time>\n                              <span className="sc6-stack-platforms">{platforms.map((platform) => <PlatformMark key={platform} platform={platform} size={10} />)}</span>\n                              <strong>{slotItems.length} contenus</strong>\n                              <small>{expanded ? 'Réduire' : 'Voir'}</small>\n                            </button>\n                            {expanded && (\n                              <div className="sc6-stack-list">\n                                {slotItems.map((item) => {\n                                  const media = library.get(mediaIdFromReference(item.mediaReference) ?? '');\n                                  return (\n                                    <button\n                                      type="button"\n                                      key={item.id}\n                                      className="sc6-stack-item"\n                                      draggable\n                                      onDragStart={(event) => { event.stopPropagation(); onDragStart(item.id); }}\n                                      onDragEnd={() => onDragStart(undefined)}\n                                      onClick={(event) => { event.stopPropagation(); onEdit(item); }}\n                                    >\n                                      <span className="sc6-stack-thumb">{media?.mimeType.startsWith('image/') ? <img src={media.previewUrl} alt="" /> : media ? <Video size={14} /> : <MessageCircle size={14} />}</span>\n                                      <span><strong>{item.body || 'Publication'}</strong><small>{item.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={9} />)}</small></span>\n                                      <Pencil size={11} />\n                                    </button>\n                                  );\n                                })}\n                              </div>\n                            )}\n                          </div>\n                        );\n                      }\n\n                      const media = library.get(mediaIdFromReference(publication.mediaReference) ?? '');\n                      return (\n                        <article\n                          key={publication.id}\n                          className={\`sc3-agenda-card \${draggedPublicationId === publication.id ? 'dragging' : ''}\`}\n                          style={{ top }}\n                          draggable\n                          onDragStart={() => onDragStart(publication.id)}\n                          onDragEnd={() => onDragStart(undefined)}\n                          onMouseEnter={() => setHoverSlot(undefined)}\n                          onClick={(event) => { event.stopPropagation(); onEdit(publication); }}\n                          title="Cliquer pour modifier cette publication"\n                        >\n                          <span className="sc5-edit-hint"><Pencil size={10} /> Modifier</span>\n                          {media?.mimeType.startsWith('image/') && <img src={media.previewUrl} alt="" />}\n                          <div><time>{formatTime(publication.scheduledAt)}</time><strong>{publication.body || 'Publication'}</strong><span>{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={11} />)}</span></div>\n                        </article>\n                      );\n                    })}\n                  </section>`;

source = source.slice(0, start) + replacement + source.slice(end + endMarker.length);

fs.writeFileSync(path, source);
console.log('Planner side drawer, live preview and collision stacks applied.');
