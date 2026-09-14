import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes("from './PlatformDestinationEditor'")) {
  console.log('Platform-aware Planner already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Platform Planner patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

replaceOnce(
  "import { ApiError, apiRequest } from './api/client';\n",
  "import { ApiError, apiRequest } from './api/client';\nimport PlatformDestinationEditor, { connectionDestinationKey, destinationPayload, makeDestinationDraft, plannedDestinationKey, type DestinationDraft } from './PlatformDestinationEditor';\nimport type { PlanningPlatform } from './shared/social-publication-fields';\n",
  'imports',
);

replaceOnce(
`type PublicationTarget = {
  id: string;
  connectionId: string;
  platform: SocialPlatform;
  status: string;
  displayName: string;
  handle?: string;
};`,
`type PublicationTarget = {
  id: string;
  connectionId?: string;
  platform: SocialPlatform;
  status: string;
  displayName: string;
  handle?: string;
  format: string;
  fields: Record<string, unknown>;
  connected: boolean;
  connectionStatus?: string;
};`,
  'publication target type',
);

replaceOnce(
`  const [publishBusy, setPublishBusy] = useState(false);
  const [editingPublication, setEditingPublication] = useState<Publication>();`,
`  const [publishBusy, setPublishBusy] = useState(false);
  const [editingPublication, setEditingPublication] = useState<Publication>();
  const [plannedPlatforms, setPlannedPlatforms] = useState<PlanningPlatform[]>([]);
  const [destinationDrafts, setDestinationDrafts] = useState<Record<string, DestinationDraft>>({});`,
  'destination state',
);

replaceOnce(
`        const connected = nextBootstrap.connections.filter((connection) => connection.status === 'connected');
        setSelectedConnectionIds((current) => {
          const valid = current.filter((id) => connected.some((connection) => connection.id === id));
          return valid.length ? valid : connected[0] ? [connected[0].id] : [];
        });`,
`        const known = nextBootstrap.connections;
        const connected = known.filter((connection) => connection.status === 'connected');
        setSelectedConnectionIds((current) => {
          const valid = current.filter((id) => known.some((connection) => connection.id === id));
          return valid.length ? valid : connected[0] ? [connected[0].id] : [];
        });`,
  'known accounts stay selectable',
);

replaceOnce(
`  function openCreate(dateKey?: string, minutes?: number) {
    setEditingPublication(undefined);
    setCustomizePerAccount(false);`,
`  function openCreate(dateKey?: string, minutes?: number) {
    setEditingPublication(undefined);
    setCustomizePerAccount(false);
    setPlannedPlatforms([]);
    setDestinationDrafts({});`,
  'new publication reset targets',
);

replaceOnce(
`    setEditingPublication(undefined);
    setPublishNow(false);`,
`    setEditingPublication(undefined);
    setPlannedPlatforms([]);
    setDestinationDrafts({});
    setPublishNow(false);`,
  'composer reset targets',
);

replaceOnce(
`    const body = publishBody.trim();
    if (!body) {
      setToast('Écrivez le contenu de la publication.');
      return;
    }
    if (!selectedConnectionIds.length) {
      setToast('Choisissez au moins un compte.');
      return;
    }

    const scheduledAt =`,
`    const body = publishBody.trim();
    const destinations = destinationPayload(connections, selectedConnectionIds, plannedPlatforms, destinationDrafts);
    if (!destinations.length) {
      setToast('Choisissez au moins une destination, connectée ou à connecter.');
      return;
    }

    const scheduledAt =`,
  'offline target validation',
);

replaceOnce(
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
`      const mediaReference = selectedMediaId ? \`library:\${selectedMediaId}\` : undefined;
      const requestPayload = {
        body,
        mediaReference,
        scheduledAt,
        connectionIds: selectedConnectionIds,
        destinations,
      };
      if (editingPublication) {
        const result = await apiRequest<{ publication: Publication }>(\`/api/publications/\${encodeURIComponent(editingPublication.id)}\`, {
          method: 'PUT',
          body: JSON.stringify({ ...requestPayload, expectedVersion: editingPublication.version }),
        }, workspaceId);
        setPublications((current) => current.map((candidate) => candidate.id === editingPublication.id ? result.publication : candidate));
        resetComposer();
        navigate('planner');
        setToast('Modifications enregistrées.');
      } else {
        const result = await apiRequest<{ publication: Publication }>('/api/publications', {
          method: 'POST',
          body: JSON.stringify(requestPayload),
        }, workspaceId);
        setPublications((current) => [...current, result.publication]);
        resetComposer();
        navigate('planner');
        setToast(result.publication.targets.some((target) => !target.connected) ? 'Ajoutée au Planner. La connexion du compte pourra être faite plus tard.' : 'Publication ajoutée au Planner.');
      }`,
  'destination-aware save flow',
);

replaceOnce(
`    setEditingPublication(publication);
    setPublishBody(publication.body);
    setSelectedConnectionIds(publication.targets.map((target) => target.connectionId));
    setSelectedMediaId(mediaIdFromReference(publication.mediaReference));`,
`    setEditingPublication(publication);
    setPublishBody(publication.body);
    const connectedIds = publication.targets.flatMap((target) => target.connectionId ? [target.connectionId] : []);
    const planned = [...new Set(publication.targets.filter((target) => !target.connectionId).map((target) => target.platform))];
    const drafts: Record<string, DestinationDraft> = {};
    for (const target of publication.targets) {
      const key = target.connectionId ? connectionDestinationKey(target.connectionId) : plannedDestinationKey(target.platform);
      drafts[key] = makeDestinationDraft(target.platform, {
        connectionId: target.connectionId,
        accountLabel: target.displayName,
        accountHandle: target.handle,
        format: target.format,
        fields: target.fields,
      });
    }
    setSelectedConnectionIds(connectedIds);
    setPlannedPlatforms(planned);
    setDestinationDrafts(drafts);
    setSelectedMediaId(mediaIdFromReference(publication.mediaReference));`,
  'edit target hydration',
);

replaceOnce(
`              editingPublication={editingPublication}
              connections={connectedConnections}
              selectedIds={selectedConnectionIds}`, 
`              editingPublication={editingPublication}
              connections={connections}
              selectedIds={selectedConnectionIds}
              plannedPlatforms={plannedPlatforms}
              destinationDrafts={destinationDrafts}`,
  'create target props',
);

replaceOnce(
`              onToggle={(id) => setSelectedConnectionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
              onSelectMedia={setSelectedMediaId}`,
`              onToggle={(id) => setSelectedConnectionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
              onTogglePlanned={(platform) => setPlannedPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform])}
              onDestinationDraft={(key, draft) => setDestinationDrafts((current) => ({ ...current, [key]: draft }))}
              onSelectMedia={setSelectedMediaId}`,
  'create target callbacks',
);

replaceOnce(
`function CreatePage({ body, editingPublication, connections, selectedIds, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {
  body: string;
  editingPublication?: Publication;
  connections: LiveConnection[];
  selectedIds: string[];`,
`function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {
  body: string;
  editingPublication?: Publication;
  connections: LiveConnection[];
  selectedIds: string[];
  plannedPlatforms: PlanningPlatform[];
  destinationDrafts: Record<string, DestinationDraft>;`,
  'create signature targets',
);

replaceOnce(
`  onBody: (value: string) => void;
  onToggle: (id: string) => void;
  onSelectMedia: (id?: string) => void;`,
`  onBody: (value: string) => void;
  onToggle: (id: string) => void;
  onTogglePlanned: (platform: PlanningPlatform) => void;
  onDestinationDraft: (key: string, draft: DestinationDraft) => void;
  onSelectMedia: (id?: string) => void;`,
  'create callback types',
);

replaceOnce(
`          <div className="sc3-selected-accounts"><strong>Publier sur</strong><div>{connections.map((connection) => <button key={connection.id} className={selectedIds.includes(connection.id) ? 'active' : ''} onClick={() => onToggle(connection.id)}><PlatformMark platform={connection.platform} /><span>{connection.displayName}</span>{selectedIds.includes(connection.id) && <Check size={13} />}</button>)}</div>{!connections.length && <p>Aucun compte social connecté.</p>}</div>
          {!editingPublication && selectedIds.length > 1 && <label className="sc3-customize-toggle"><input type="checkbox" checked={customize} onChange={(event) => onCustomize(event.target.checked)} /><span><strong>Adapter le texte par compte</strong><small>À utiliser seulement si les plateformes nécessitent une variante.</small></span></label>}
          {!editingPublication && customize && selectedConnections.map((connection) => <label className="sc3-variant" key={connection.id}><span><PlatformMark platform={connection.platform} /> {connection.displayName}</span><textarea value={accountBodies[connection.id] ?? body} onChange={(event) => onAccountBody(connection.id, event.target.value)} /></label>)}`,
`          <PlatformDestinationEditor
            connections={connections}
            selectedConnectionIds={selectedIds}
            plannedPlatforms={plannedPlatforms}
            drafts={destinationDrafts}
            onToggleConnection={onToggle}
            onTogglePlanned={onTogglePlanned}
            onDraft={onDestinationDraft}
          />`,
  'network-aware fields',
);

replaceOnce(
`          <div className="sc3-compose-summary"><span>{selectedIds.length} compte{selectedIds.length > 1 ? 's' : ''}</span><span>{selectedMedia ? '1 média' : 'Sans média'}</span><span>{body.length}/5000</span></div>`,
`          <div className="sc3-compose-summary"><span>{selectedIds.length + plannedPlatforms.length} destination{selectedIds.length + plannedPlatforms.length > 1 ? 's' : ''}</span><span>{plannedPlatforms.length ? \`${plannedPlatforms.length} à connecter\` : 'Comptes reliés'}</span><span>{selectedMedia ? '1 média' : 'Sans média'}</span></div>`,
  'composer summary',
);

replaceOnce(
`          <button className="sc3-primary wide" disabled={busy || !body.trim() || !selectedIds.length} onClick={onSchedule}>`,
`          <button className="sc3-primary wide" disabled={busy || (!selectedIds.length && !plannedPlatforms.length)} onClick={onSchedule}>`,
  'planner save enabled without connection or common text',
);

fs.writeFileSync(path, source);
console.log('Offline Planner targets and platform-specific fields applied.');
