import fs from 'node:fs';

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
app = app.replace(
  `{(!editingPublication || editingPublication.status === 'draft') && <button type="button" className="sc16-draft-button" disabled={busy || !selectedCount} onClick={onSaveDraft}>{busy ? 'Enregistrement…' : 'Enregistrer en brouillon'}</button>}`,
  `<button type="button" className="sc16-draft-button" disabled={busy || !selectedCount} onClick={onSaveDraft}>{busy ? 'Enregistrement…' : 'Enregistrer en brouillon'}</button>`,
);
app = app.replace(
  `{busy ? 'Enregistrement…' : editingPublication?.status === 'draft' ? 'Programmer la publication' : 'Valider la publication'}`,
  `{busy ? 'Enregistrement…' : 'Programmer la publication'}`,
);
app = app.replace(
  `<button className="sc3-primary wide" disabled={busy || (!selectedIds.length && !plannedPlatforms.length) || incompatibleDestinations.length > 0} onClick={onSchedule}>{busy ? 'Enregistrement…' : editingPublication ? 'Enregistrer les modifications' : deliveryReady ? (publishNow ? 'Publier maintenant' : 'Programmer') : 'Ajouter au Planner'} <ChevronRight size={16} /></button>`,
  `{editingPublication?.status === 'draft' && <button type="button" className="sc16-draft-button wide" disabled={busy} onClick={onSaveDraft}>{busy ? 'Enregistrement…' : 'Enregistrer le brouillon'}</button>}<button className="sc3-primary wide" disabled={busy || (!selectedIds.length && !plannedPlatforms.length) || incompatibleDestinations.length > 0} onClick={onSchedule}>{busy ? 'Enregistrement…' : editingPublication?.status === 'draft' ? 'Programmer la publication' : editingPublication ? 'Enregistrer les modifications' : deliveryReady ? (publishNow ? 'Publier maintenant' : 'Programmer') : 'Ajouter au Planner'} <ChevronRight size={16} /></button>`,
);
fs.writeFileSync(appPath, app);

const youtubePath = 'src/worker/youtube-publishing.ts';
let youtube = fs.readFileSync(youtubePath, 'utf8');
youtube = youtube.replace(
  `WHERE p.status = 'scheduled' AND p.scheduled_at > ?`,
  `WHERE p.status = 'scheduled'`,
);
youtube = youtube.replace(
  `destination.post_status === 'draft' || destination.post_status === 'draft' ||`,
  `destination.post_status === 'draft' ||`,
);
fs.writeFileSync(youtubePath, youtube);

console.log('YouTube lifecycle v2 generated code finalized.');
