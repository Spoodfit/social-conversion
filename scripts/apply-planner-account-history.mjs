import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Planner account history patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

function replaceOptional(source, before, after) {
  return source.includes(before) ? source.replace(before, after) : source;
}

// 1) Authenticated read-through API. A provider failure never hides cached history.
const workerPath = 'src/worker/index.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('SC_PLANNER_ACCOUNT_HISTORY_API_V1')) {
  worker = replaceOnce(
    worker,
    `import { persistSocialEvent } from './persistence';`,
    `import { persistSocialEvent } from './persistence';\nimport { listRemotePlannerPublications, syncWorkspacePlannerHistory } from './planner-account-history';`,
    'worker import',
  );

  worker = replaceOnce(
    worker,
    `  app.notFound((c) => c.json({ error: 'Not found' }, 404));`,
    `  app.get('/api/planner/history', async (c) => {\n    if (!liveDataReady(c.env)) {\n      return c.json({ error: 'Live Planner history is locked.', code: 'LIVE_NOT_READY' }, 503);\n    }\n    const principal = c.get('principal');\n    const sync = await syncWorkspacePlannerHistory(c.env.DB, c.env, principal.workspaceId);\n    const publications = await listRemotePlannerPublications(c.env.DB, principal.workspaceId);\n    return c.json({ publications, sync });\n  });\n\n  app.notFound((c) => c.json({ error: 'Not found' }, 404));`,
    'worker route',
  );
  worker += '\n// SC_PLANNER_ACCOUNT_HISTORY_API_V1\n';
  fs.writeFileSync(workerPath, worker);
}

// 2) Merge provider-native timeline with Social Conversion publications.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_PLANNER_ACCOUNT_HISTORY_UI_V1')) {
  const publicationStart = app.indexOf('type Publication = {');
  const publicationEnd = publicationStart >= 0 ? app.indexOf('\n};', publicationStart) : -1;
  if (publicationStart < 0 || publicationEnd < 0) {
    throw new Error('Planner account history patch failed: Publication type not found.');
  }
  const publicationBlock = app.slice(publicationStart, publicationEnd);
  if (!publicationBlock.includes('readOnly?: boolean;')) {
    app = app.slice(0, publicationEnd)
      + `\n  source?: 'social-conversion' | 'provider';\n  readOnly?: boolean;\n  externalUrl?: string;\n  providerStatus?: 'published' | 'scheduled';`
      + app.slice(publicationEnd);
  }

  app = replaceOnce(
    app,
    `function mediaIdFromReference(value?: string) {\n  return value?.startsWith('library:') ? value.slice('library:'.length) : undefined;\n}\n`,
    `function mediaIdFromReference(value?: string) {\n  return value?.startsWith('library:') ? value.slice('library:'.length) : undefined;\n}\n\nfunction plannerProviderKey(target: PublicationTarget) {\n  return target.externalId ? \`\${target.platform}:\${target.connectionId ?? ''}:\${target.externalId}\` : undefined;\n}\n\nfunction mergePlannerPublications(managed: Publication[], provider: Publication[]) {\n  const managedProviderIds = new Set<string>();\n  for (const publication of managed) {\n    for (const target of publication.targets) {\n      const key = plannerProviderKey(target);\n      if (key) managedProviderIds.add(key);\n    }\n  }\n  const merged = [...managed];\n  for (const publication of provider) {\n    const duplicate = publication.targets.some((target) => {\n      const key = plannerProviderKey(target);\n      return key ? managedProviderIds.has(key) : false;\n    });\n    if (!duplicate) merged.push(publication);\n  }\n  return merged.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());\n}\n`,
    'planner merge helper',
  );

  app = replaceOnce(
    app,
    `    apiRequest<{ publications: Publication[] }>('/api/publications', {}, workspaceId)\n      .then((payload) => active && setPublications(payload.publications))\n      .catch((error) => active && setToast(readableError(error)))\n      .finally(() => active && setLoadingPublications(false));`,
    `    apiRequest<{ publications: Publication[] }>('/api/publications', {}, workspaceId)\n      .then((payload) => {\n        if (!active) return;\n        const managed = payload.publications;\n        setPublications(managed);\n        setLoadingPublications(false);\n        void apiRequest<{ publications: Publication[] }>('/api/planner/history', {}, workspaceId)\n          .then((history) => {\n            if (active) setPublications(mergePlannerPublications(managed, history.publications));\n          })\n          .catch(() => undefined);\n      })\n      .catch((error) => active && setToast(readableError(error)))\n      .finally(() => active && setLoadingPublications(false));`,
    'planner history fetch',
  );

  app = replaceOnce(
    app,
    `  function editPublication(publication: Publication) {\n`,
    `  function editPublication(publication: Publication) {\n    if (publication.readOnly) {\n      if (publication.externalUrl) {\n        window.open(publication.externalUrl, '_blank', 'noopener,noreferrer');\n      } else {\n        setToast(publication.providerStatus === 'scheduled'\n          ? 'Cette publication est programmée sur le réseau d’origine.'\n          : 'Cette publication provient du compte social connecté.');\n      }\n      return;\n    }\n`,
    'read-only imported post click',
  );

  app = replaceOnce(
    app,
    `  async function movePublication(publication: Publication, targetDateKey: string, minutes: number) {\n`,
    `  async function movePublication(publication: Publication, targetDateKey: string, minutes: number) {\n    if (publication.readOnly) {\n      setToast('Une publication importée se modifie sur le réseau d’origine.');\n      return;\n    }\n`,
    'read-only imported post drag',
  );

  // Week cards after the existing status/readiness patches.
  app = replaceOptional(
    app,
    `className={\`sc3-agenda-card\${plannerProgrammed ? ' sc13-programmed' : ''}\${plannerSyncFailed ? ' sc13-sync-failed' : ''} \${draggedPublicationId === publication.id ? 'dragging' : ''}\`}`,
    `className={\`sc3-agenda-card\${plannerProgrammed ? ' sc13-programmed' : ''}\${plannerSyncFailed ? ' sc13-sync-failed' : ''}\${publication.readOnly ? ' sc14-provider' : ''} \${draggedPublicationId === publication.id ? 'dragging' : ''}\`}`,
  );
  app = replaceOptional(
    app,
    `                          draggable\n                          onDragStart={() => onDragStart(publication.id)}`,
    `                          draggable={!publication.readOnly}\n                          onDragStart={() => { if (!publication.readOnly) onDragStart(publication.id); }}`,
  );
  app = replaceOptional(
    app,
    `<span className="sc5-edit-hint"><Pencil size={10} /> Modifier</span>`,
    `<span className="sc5-edit-hint">{publication.readOnly ? <><Eye size={10} /> Voir</> : <><Pencil size={10} /> Modifier</>}</span>`,
  );
  app = replaceOptional(
    app,
    `<div><time>{formatTime(publication.scheduledAt)}</time><strong>{publication.body || 'Publication'}</strong><span className="sc13-card-meta">`,
    `<div><time>{formatTime(publication.scheduledAt)}{publication.readOnly && <em className={\`sc14-provider-badge \${publication.providerStatus ?? 'published'}\`}>{publication.providerStatus === 'scheduled' ? 'Programmé' : 'Publié'}</em>}</time><strong>{publication.body || 'Publication'}</strong><span className="sc13-card-meta">`,
  );
  app = replaceOptional(
    app,
    `                          title="Cliquer pour modifier cette publication"`,
    `                          title={publication.readOnly ? 'Ouvrir la publication sur le réseau' : 'Cliquer pour modifier cette publication'}`,
  );

  // Collision stacks.
  app = replaceOptional(
    app,
    `                                      draggable\n                                      onDragStart={(event) => { event.stopPropagation(); onDragStart(item.id); }}`,
    `                                      draggable={!item.readOnly}\n                                      onDragStart={(event) => { event.stopPropagation(); if (!item.readOnly) onDragStart(item.id); }}`,
  );
  app = replaceOptional(
    app,
    `<span><strong>{item.body || 'Publication'}</strong><small className="sc13-stack-meta">`,
    `<span><strong>{item.body || 'Publication'}</strong>{item.readOnly && <em className={\`sc14-provider-badge \${item.providerStatus ?? 'published'}\`}>{item.providerStatus === 'scheduled' ? 'Programmé' : 'Publié'}</em>}<small className="sc13-stack-meta">`,
  );

  // List view is the easiest way to inspect the full past/future timeline.
  app = replaceOptional(
    app,
    `<button key={publication.id} onClick={() => onEdit(publication)}>`,
    `<button key={publication.id} className={publication.readOnly ? 'sc14-list-provider' : undefined} onClick={() => onEdit(publication)}>`,
  );
  app = replaceOptional(
    app,
    `<time>{new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(publication.scheduledAt))}</time>`,
    `<time>{new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(publication.scheduledAt))}{publication.readOnly && <em className={\`sc14-provider-badge \${publication.providerStatus ?? 'published'}\`}>{publication.providerStatus === 'scheduled' ? 'Programmé' : 'Publié'}</em>}</time>`,
  );
  app = app.replace('Aucune publication programmée', 'Aucune publication');

  app += '\n/* SC_PLANNER_ACCOUNT_HISTORY_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

// 3) Styling import.
const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./planner-account-history.css")) {
  main += "\nimport './planner-account-history.css';\n";
  fs.writeFileSync(mainPath, main);
}

console.log('Provider account history is merged into the Planner timeline.');
