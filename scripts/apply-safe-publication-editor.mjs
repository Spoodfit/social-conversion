import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('const [editingPublication, setEditingPublication]')) {
  console.log('Safe publication editor already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Safe editor patch failed: ${label} anchor not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  "  const [publishBusy, setPublishBusy] = useState(false);\n",
  "  const [publishBusy, setPublishBusy] = useState(false);\n  const [editingPublication, setEditingPublication] = useState<Publication>();\n",
  'editing state',
);

replaceOnce(
`  function openCreate(dateKey?: string, minutes?: number) {
    if (dateKey) setScheduleDate(dateKey);`,
`  function openCreate(dateKey?: string, minutes?: number) {
    setEditingPublication(undefined);
    setCustomizePerAccount(false);
    if (dateKey) setScheduleDate(dateKey);`,
  'new publication entry',
);

replaceOnce(
`    setAccountBodies({});
    setCustomizePerAccount(false);`,
`    setAccountBodies({});
    setCustomizePerAccount(false);
    setEditingPublication(undefined);`,
  'composer reset',
);

replaceOnce(
`      const mediaReference = selectedMediaId ? \`library:\${selectedMediaId}\` : undefined;
      const created: Publication[] = [];
      if (customizePerAccount && selectedConnectionIds.length > 1) {
        for (const connectionId of selectedConnectionIds) {
          const result = await apiRequest<{ publication: Publication }>('/api/publications', {
            method: 'POST',
            body: JSON.stringify({
              body: (accountBodies[connectionId] ?? body).trim() || body,
              mediaReference,
              scheduledAt,
              connectionIds: [connectionId],
            }),
          }, workspaceId);
          created.push(result.publication);
        }
      } else {
        const result = await apiRequest<{ publication: Publication }>('/api/publications', {
          method: 'POST',
          body: JSON.stringify({ body, mediaReference, scheduledAt, connectionIds: selectedConnectionIds }),
        }, workspaceId);
        created.push(result.publication);
      }
      setPublications((current) => [...current, ...created]);
      resetComposer();
      navigate('planner');
      setToast(runtime.contentPublishingReady ? 'Publication programmée.' : 'Publication ajoutée au Planner.');`,
`      const mediaReference = selectedMediaId ? \`library:\${selectedMediaId}\` : undefined;
      if (editingPublication) {
        const result = await apiRequest<{ publication: Publication }>(\`/api/publications/\${encodeURIComponent(editingPublication.id)}\`, {
          method: 'PUT',
          body: JSON.stringify({
            body,
            mediaReference,
            scheduledAt,
            connectionIds: selectedConnectionIds,
            expectedVersion: editingPublication.version,
          }),
        }, workspaceId);
        setPublications((current) => current.map((candidate) => candidate.id === editingPublication.id ? result.publication : candidate));
        resetComposer();
        navigate('planner');
        setToast('Modifications enregistrées.');
      } else {
        const created: Publication[] = [];
        if (customizePerAccount && selectedConnectionIds.length > 1) {
          for (const connectionId of selectedConnectionIds) {
            const result = await apiRequest<{ publication: Publication }>('/api/publications', {
              method: 'POST',
              body: JSON.stringify({
                body: (accountBodies[connectionId] ?? body).trim() || body,
                mediaReference,
                scheduledAt,
                connectionIds: [connectionId],
              }),
            }, workspaceId);
            created.push(result.publication);
          }
        } else {
          const result = await apiRequest<{ publication: Publication }>('/api/publications', {
            method: 'POST',
            body: JSON.stringify({ body, mediaReference, scheduledAt, connectionIds: selectedConnectionIds }),
          }, workspaceId);
          created.push(result.publication);
        }
        setPublications((current) => [...current, ...created]);
        resetComposer();
        navigate('planner');
        setToast(runtime.contentPublishingReady ? 'Publication programmée.' : 'Publication ajoutée au Planner.');
      }`,
  'schedule/update flow',
);

replaceOnce(
`  async function editPublication(publication: Publication) {
    if (!workspaceId || publishBusy) return;
    setPublishBusy(true);
    try {
      await apiRequest(\`/api/publications/\${encodeURIComponent(publication.id)}\`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion: publication.version }),
      }, workspaceId);
      setPublications((current) => current.filter((candidate) => candidate.id !== publication.id));
      const date = new Date(publication.scheduledAt);
      setPublishBody(publication.body);
      setSelectedConnectionIds(publication.targets.map((target) => target.connectionId));
      setSelectedMediaId(mediaIdFromReference(publication.mediaReference));
      setScheduleDate(localDateKey(date));
      setScheduleTime(\`\${String(date.getHours()).padStart(2, '0')}:\${String(date.getMinutes()).padStart(2, '0')}\`);
      setPublishNow(false);
      navigate('create');
      setToast('Publication ouverte en modification.');
    } catch (error) {
      setToast(readableError(error));
    } finally {
      setPublishBusy(false);
    }
  }
`,
`  function editPublication(publication: Publication) {
    const date = new Date(publication.scheduledAt);
    setEditingPublication(publication);
    setPublishBody(publication.body);
    setSelectedConnectionIds(publication.targets.map((target) => target.connectionId));
    setSelectedMediaId(mediaIdFromReference(publication.mediaReference));
    setScheduleDate(localDateKey(date));
    setScheduleTime(\`\${String(date.getHours()).padStart(2, '0')}:\${String(date.getMinutes()).padStart(2, '0')}\`);
    setPublishNow(false);
    setCustomizePerAccount(false);
    setAccountBodies({});
    navigate('create');
  }

  async function cancelEditingPublication() {
    if (!workspaceId || !editingPublication || publishBusy) return;
    if (!window.confirm('Annuler définitivement cette publication programmée ?')) return;
    setPublishBusy(true);
    try {
      await apiRequest(\`/api/publications/\${encodeURIComponent(editingPublication.id)}\`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion: editingPublication.version }),
      }, workspaceId);
      setPublications((current) => current.filter((candidate) => candidate.id !== editingPublication.id));
      resetComposer();
      navigate('planner');
      setToast('Publication annulée.');
    } catch (error) {
      setToast(readableError(error));
      setRefreshIndex((value) => value + 1);
    } finally {
      setPublishBusy(false);
    }
  }
`,
  'non destructive editor',
);

replaceOnce(
`            <strong>{page === 'planner' ? 'Planner' : page === 'inbox' ? 'Inbox' : page === 'library' ? 'Bibliothèque' : page === 'create' ? 'Nouvelle publication' : 'Réglages'}</strong>`,
`            <strong>{page === 'planner' ? 'Planner' : page === 'inbox' ? 'Inbox' : page === 'library' ? 'Bibliothèque' : page === 'create' ? (editingPublication ? 'Modifier la publication' : 'Nouvelle publication') : 'Réglages'}</strong>`,
  'topbar editor title',
);

replaceOnce(
`              body={publishBody}
              connections={connectedConnections}`, 
`              body={publishBody}
              editingPublication={editingPublication}
              connections={connectedConnections}`,
  'create editing prop',
);

replaceOnce(
`              onSchedule={() => void schedulePublication()}
            />`,
`              onSchedule={() => void schedulePublication()}
              onBack={() => { resetComposer(); navigate('planner'); }}
              onCancel={() => void cancelEditingPublication()}
            />`,
  'create editor actions',
);

replaceOnce(
`function CreatePage({ body, connections, selectedIds, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule }: {
  body: string;
  connections: LiveConnection[];`,
`function CreatePage({ body, editingPublication, connections, selectedIds, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {
  body: string;
  editingPublication?: Publication;
  connections: LiveConnection[];`,
  'create signature',
);

replaceOnce(
`  onAccountBody: (id: string, value: string) => void;
  onSchedule: () => void;
}) {`,
`  onAccountBody: (id: string, value: string) => void;
  onSchedule: () => void;
  onBack: () => void;
  onCancel: () => void;
}) {`,
  'create action types',
);

replaceOnce(
`      <div className="sc3-page-head compact"><div><h1>Nouvelle publication</h1><p>Contenu → comptes → date. Rien de plus.</p></div></div>`,
`      <div className="sc3-page-head compact"><div><h1>{editingPublication ? 'Modifier la publication' : 'Nouvelle publication'}</h1><p>{editingPublication ? 'Modifiez sans supprimer la programmation existante.' : 'Contenu → comptes → date. Rien de plus.'}</p></div><button className="sc3-secondary" onClick={onBack}><ChevronLeft size={15} /> Retour au Planner</button></div>`,
  'create heading',
);

replaceOnce(
`          {selectedIds.length > 1 && <label className="sc3-customize-toggle">`,
`          {!editingPublication && selectedIds.length > 1 && <label className="sc3-customize-toggle">`,
  'disable variants while editing',
);

replaceOnce(
`          {customize && selectedConnections.map((connection) =>`,
`          {!editingPublication && customize && selectedConnections.map((connection) =>`,
  'disable variant fields while editing',
);

replaceOnce(
`          <button className="sc3-primary wide" disabled={busy || !body.trim() || !selectedIds.length} onClick={onSchedule}>{busy ? 'Enregistrement…' : deliveryReady ? (publishNow ? 'Publier maintenant' : 'Programmer') : 'Ajouter au Planner'} <ChevronRight size={16} /></button>
          {!deliveryReady && <small className="sc3-delivery-note">`,
`          <button className="sc3-primary wide" disabled={busy || !body.trim() || !selectedIds.length} onClick={onSchedule}>{busy ? 'Enregistrement…' : editingPublication ? 'Enregistrer les modifications' : deliveryReady ? (publishNow ? 'Publier maintenant' : 'Programmer') : 'Ajouter au Planner'} <ChevronRight size={16} /></button>
          {editingPublication && <button className="sc3-cancel-publication" disabled={busy} onClick={onCancel}><Trash2 size={14} /> Annuler cette publication</button>}
          {!deliveryReady && <small className="sc3-delivery-note">`,
  'save and cancel controls',
);

fs.writeFileSync(path, source);
console.log('Safe non-destructive publication editor applied.');
