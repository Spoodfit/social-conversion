import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('plannerNeedsConnection')) {
  console.log('Planner readiness status already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Planner readiness patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

// Drawer: a planned publication is not "ready" when at least one destination is disconnected.
replaceOnce(
`  const youtubePrivacyLabel = youtubePrivacy === 'public' ? 'Publique programmée'\n    : youtubePrivacy === 'unlisted' ? 'Non répertoriée'\n      : youtubePrivacy === 'private' ? 'Privée' : undefined;`,
`  const youtubePrivacyLabel = youtubePrivacy === 'public' ? 'Publique programmée'\n    : youtubePrivacy === 'unlisted' ? 'Non répertoriée'\n      : youtubePrivacy === 'private' ? 'Privée' : undefined;\n  const plannerNeedsConnection = Boolean(editingPublication?.targets.some((target) => !target.connected || target.connectionStatus !== 'connected'));\n  const plannerHasSyncFailure = Boolean(editingPublication?.targets.some((target) => target.syncStatus === 'failed'));\n  const plannerDrawerReady = Boolean(editingPublication && editingPublication.status === 'scheduled' && !plannerNeedsConnection && !plannerHasSyncFailure);\n  const plannerDrawerStatus = plannerHasSyncFailure ? 'Erreur de diffusion'\n    : plannerNeedsConnection ? 'Compte à connecter'\n      : plannerDrawerReady ? 'Publication planifiée'\n        : editingPublication ? 'Planification incomplète' : 'Nouvelle publication';`,
  'drawer readiness state',
);

replaceOnce(
`<span className="sc8-status-dot"><i /> {editingPublication ? 'Publication planifiée' : 'Nouvelle publication'}</span>`,
`<span className={\`sc8-status-dot\${plannerHasSyncFailure ? ' sc14-error' : plannerNeedsConnection ? ' sc14-needs-connection' : plannerDrawerReady ? ' sc14-ready' : ''}\`}><i /> {plannerDrawerStatus}</span>`,
  'drawer readiness badge',
);

// Single planner card: green only if every target is actually connected.
replaceOnce(
`                      const plannerSyncFailed = publication.targets.some((target) => target.syncStatus === 'failed');\n                      const plannerProgrammed = publication.status === 'scheduled' && !plannerSyncFailed;`,
`                      const plannerSyncFailed = publication.targets.some((target) => target.syncStatus === 'failed');\n                      const plannerNeedsConnection = publication.targets.some((target) => !target.connected || target.connectionStatus !== 'connected');\n                      const plannerProgrammed = publication.status === 'scheduled' && publication.targets.length > 0 && !plannerSyncFailed && !plannerNeedsConnection;`,
  'single card readiness state',
);

replaceOnce(
`className={\`sc3-agenda-card\${plannerProgrammed ? ' sc13-programmed' : ''}\${plannerSyncFailed ? ' sc13-sync-failed' : ''} \${draggedPublicationId === publication.id ? 'dragging' : ''}\`}`,
`className={\`sc3-agenda-card\${plannerProgrammed ? ' sc13-programmed' : ''}\${plannerNeedsConnection && !plannerSyncFailed ? ' sc14-needs-connection' : ''}\${plannerSyncFailed ? ' sc13-sync-failed' : ''} \${draggedPublicationId === publication.id ? 'dragging' : ''}\`}`,
  'single card readiness class',
);

replaceOnce(
`<span className="sc13-card-meta"><span>{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={11} />)}</span>{plannerPrivacy && <small className={\`sc13-card-visibility \${plannerPrivacy}\`}>{plannerPrivacy === 'public' ? '🌍 Publique' : plannerPrivacy === 'unlisted' ? '🔗 Non répertoriée' : '🔒 Privée'}</small>}</span>`,
`<span className="sc13-card-meta"><span>{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={11} />)}</span>{plannerNeedsConnection ? <small className="sc14-card-readiness needs-connection">À connecter</small> : plannerSyncFailed ? <small className="sc14-card-readiness error">Erreur</small> : plannerPrivacy && <small className={\`sc13-card-visibility \${plannerPrivacy}\`}>{plannerPrivacy === 'public' ? '🌍 Publique' : plannerPrivacy === 'unlisted' ? '🔗 Non répertoriée' : '🔒 Privée'}</small>}</span>`,
  'single card readiness label',
);

// Collision stacks inherit the strictest state of the publications they contain.
replaceOnce(
`                        const stackSyncFailed = slotItems.some((item) => item.targets.some((target) => target.syncStatus === 'failed'));\n                        const stackProgrammed = slotItems.every((item) => item.status === 'scheduled') && !stackSyncFailed;`,
`                        const stackSyncFailed = slotItems.some((item) => item.targets.some((target) => target.syncStatus === 'failed'));\n                        const stackNeedsConnection = slotItems.some((item) => item.targets.some((target) => !target.connected || target.connectionStatus !== 'connected'));\n                        const stackProgrammed = slotItems.every((item) => item.status === 'scheduled' && item.targets.length > 0) && !stackSyncFailed && !stackNeedsConnection;`,
  'stack readiness state',
);

replaceOnce(
`className={\`sc6-slot-stack\${expanded ? ' expanded' : ''}\${stackProgrammed ? ' sc13-programmed' : ''}\${stackSyncFailed ? ' sc13-sync-failed' : ''}\`}`,
`className={\`sc6-slot-stack\${expanded ? ' expanded' : ''}\${stackProgrammed ? ' sc13-programmed' : ''}\${stackNeedsConnection && !stackSyncFailed ? ' sc14-needs-connection' : ''}\${stackSyncFailed ? ' sc13-sync-failed' : ''}\`}`,
  'stack readiness class',
);

replaceOnce(
`                                  const itemYouTubeTarget = item.targets.find((target) => target.platform === 'youtube');`,
`                                  const itemNeedsConnection = item.targets.some((target) => !target.connected || target.connectionStatus !== 'connected');\n                                  const itemSyncFailed = item.targets.some((target) => target.syncStatus === 'failed');\n                                  const itemYouTubeTarget = item.targets.find((target) => target.platform === 'youtube');`,
  'stack item readiness state',
);

replaceOnce(
`<small className="sc13-stack-meta"><span>{item.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={9} />)}</span>{itemPrivacy && <em className={\`sc13-card-visibility \${itemPrivacy}\`}>{itemPrivacy === 'public' ? '🌍 Publique' : itemPrivacy === 'unlisted' ? '🔗 Non répertoriée' : '🔒 Privée'}</em>}</small>`,
`<small className="sc13-stack-meta"><span>{item.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={9} />)}</span>{itemNeedsConnection ? <em className="sc14-card-readiness needs-connection">À connecter</em> : itemSyncFailed ? <em className="sc14-card-readiness error">Erreur</em> : itemPrivacy && <em className={\`sc13-card-visibility \${itemPrivacy}\`}>{itemPrivacy === 'public' ? '🌍 Publique' : itemPrivacy === 'unlisted' ? '🔗 Non répertoriée' : '🔒 Privée'}</em>}</small>`,
  'stack item readiness label',
);

fs.writeFileSync(path, source);
console.log('Planner destination readiness colors applied.');
