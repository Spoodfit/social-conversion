import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('sc13-visibility-badge')) {
  console.log('Planner publication status UI already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Planner publication status patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

// Drawer: expose the actual YouTube visibility next to the remote sync state.
replaceOnce(
`  const youtubeSyncLabel = youtubeTarget?.syncStatus === 'scheduled' ? 'Programmé sur YouTube'
    : youtubeTarget?.syncStatus === 'uploaded' ? 'Envoyé sur YouTube'
      : youtubeTarget?.syncStatus === 'syncing' || youtubeTarget?.syncStatus === 'queued' ? 'Synchronisation YouTube…'
        : youtubeTarget?.syncStatus === 'failed' ? 'Erreur de synchronisation YouTube'
          : undefined;`,
`  const youtubeSyncLabel = youtubeTarget?.syncStatus === 'scheduled' ? 'Programmé sur YouTube'
    : youtubeTarget?.syncStatus === 'uploaded' ? 'Envoyé sur YouTube'
      : youtubeTarget?.syncStatus === 'syncing' || youtubeTarget?.syncStatus === 'queued' ? 'Synchronisation YouTube…'
        : youtubeTarget?.syncStatus === 'failed' ? 'Erreur de synchronisation YouTube'
          : undefined;
  const youtubePrivacy = youtubeTarget
    ? youtubeTarget.fields?.privacyStatus === 'public' || youtubeTarget.syncStatus === 'scheduled'
      ? 'public'
      : youtubeTarget.fields?.privacyStatus === 'unlisted'
        ? 'unlisted'
        : 'private'
    : undefined;
  const youtubePrivacyLabel = youtubePrivacy === 'public' ? 'Publique programmée'
    : youtubePrivacy === 'unlisted' ? 'Non répertoriée'
      : youtubePrivacy === 'private' ? 'Privée' : undefined;`,
  'drawer visibility state',
);

replaceOnce(
`<span className="sc8-status-dot"><i /> {editingPublication ? 'Publication planifiée' : 'Nouvelle publication'}</span>{youtubeSyncLabel && <span className={\`sc11-youtube-sync \${youtubeTarget?.syncStatus ?? ''}\`}>{youtubeSyncLabel}</span>}`,
`<span className="sc8-status-dot"><i /> {editingPublication ? 'Publication planifiée' : 'Nouvelle publication'}</span>{youtubeSyncLabel && <span className={\`sc11-youtube-sync \${youtubeTarget?.syncStatus ?? ''}\`}>{youtubeSyncLabel}</span>}{youtubePrivacyLabel && <span className={\`sc13-visibility-badge \${youtubePrivacy}\`}>{youtubePrivacy === 'public' ? '🌍' : youtubePrivacy === 'private' ? '🔒' : '🔗'} {youtubePrivacyLabel}</span>}`,
  'drawer visibility badge',
);

// Planner: compute schedule/error/visibility state for each single card.
replaceOnce(
`                      const media = library.get(mediaIdFromReference(publication.mediaReference) ?? '');
                      return (
                        <article
                          key={publication.id}
                          className={\`sc3-agenda-card \${draggedPublicationId === publication.id ? 'dragging' : ''}\`}`,
`                      const media = library.get(mediaIdFromReference(publication.mediaReference) ?? '');
                      const plannerYouTubeTarget = publication.targets.find((target) => target.platform === 'youtube');
                      const plannerSyncFailed = publication.targets.some((target) => target.syncStatus === 'failed');
                      const plannerProgrammed = publication.status === 'scheduled' && !plannerSyncFailed;
                      const plannerPrivacy = plannerYouTubeTarget
                        ? plannerYouTubeTarget.fields?.privacyStatus === 'public' || plannerYouTubeTarget.syncStatus === 'scheduled'
                          ? 'public'
                          : plannerYouTubeTarget.fields?.privacyStatus === 'unlisted'
                            ? 'unlisted'
                            : 'private'
                        : undefined;
                      return (
                        <article
                          key={publication.id}
                          className={\`sc3-agenda-card\${plannerProgrammed ? ' sc13-programmed' : ''}\${plannerSyncFailed ? ' sc13-sync-failed' : ''} \${draggedPublicationId === publication.id ? 'dragging' : ''}\`}`,
  'single planner card status classes',
);

replaceOnce(
`                          <div><time>{formatTime(publication.scheduledAt)}</time><strong>{publication.body || 'Publication'}</strong><span>{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={11} />)}</span></div>`,
`                          <div><time>{formatTime(publication.scheduledAt)}</time><strong>{publication.body || 'Publication'}</strong><span className="sc13-card-meta"><span>{publication.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={11} />)}</span>{plannerPrivacy && <small className={\`sc13-card-visibility \${plannerPrivacy}\`}>{plannerPrivacy === 'public' ? '🌍 Publique' : plannerPrivacy === 'unlisted' ? '🔗 Non répertoriée' : '🔒 Privée'}</small>}</span></div>`,
  'single planner card visibility',
);

// Collision stacks: green outline when every publication is scheduled and none has a known sync failure.
replaceOnce(
`                        const expanded = expandedSlot === slotId;
                        const platforms = [...new Set(slotItems.flatMap((item) => item.targets.map((target) => target.platform)))];
                        return (
                          <div key={slotId} className={\`sc6-slot-stack\${expanded ? ' expanded' : ''}\`} style={{ top }} onClick={(event) => event.stopPropagation()}>`,
`                        const expanded = expandedSlot === slotId;
                        const platforms = [...new Set(slotItems.flatMap((item) => item.targets.map((target) => target.platform)))];
                        const stackSyncFailed = slotItems.some((item) => item.targets.some((target) => target.syncStatus === 'failed'));
                        const stackProgrammed = slotItems.every((item) => item.status === 'scheduled') && !stackSyncFailed;
                        return (
                          <div key={slotId} className={\`sc6-slot-stack\${expanded ? ' expanded' : ''}\${stackProgrammed ? ' sc13-programmed' : ''}\${stackSyncFailed ? ' sc13-sync-failed' : ''}\`} style={{ top }} onClick={(event) => event.stopPropagation()}>`,
  'stack status classes',
);

replaceOnce(
`                                  const media = library.get(mediaIdFromReference(item.mediaReference) ?? '');
                                  return (
                                    <button`,
`                                  const media = library.get(mediaIdFromReference(item.mediaReference) ?? '');
                                  const itemYouTubeTarget = item.targets.find((target) => target.platform === 'youtube');
                                  const itemPrivacy = itemYouTubeTarget
                                    ? itemYouTubeTarget.fields?.privacyStatus === 'public' || itemYouTubeTarget.syncStatus === 'scheduled'
                                      ? 'public'
                                      : itemYouTubeTarget.fields?.privacyStatus === 'unlisted'
                                        ? 'unlisted'
                                        : 'private'
                                    : undefined;
                                  return (
                                    <button`,
  'stack item visibility state',
);

replaceOnce(
`                                      <span><strong>{item.body || 'Publication'}</strong><small>{item.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={9} />)}</small></span>`,
`                                      <span><strong>{item.body || 'Publication'}</strong><small className="sc13-stack-meta"><span>{item.targets.map((target) => <PlatformMark key={target.id} platform={target.platform} size={9} />)}</span>{itemPrivacy && <em className={\`sc13-card-visibility \${itemPrivacy}\`}>{itemPrivacy === 'public' ? '🌍 Publique' : itemPrivacy === 'unlisted' ? '🔗 Non répertoriée' : '🔒 Privée'}</em>}</small></span>`,
  'stack item visibility badge',
);

fs.writeFileSync(path, source);
console.log('Planner programmed outline and YouTube visibility badges applied.');
