import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('sc14-meta-publishable-fix')) {
  console.log('Meta publishable connection isolation already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Meta publishable fix failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

replaceOnce(
  "  const publishableConnections = useMemo(() => connectedConnections.filter((connection): connection is LiveConnection & { platform: SocialPlatform } => connection.platform !== 'facebook'), [connectedConnections]);",
  "  const publishableConnections = useMemo(() => connections.filter((connection): connection is LiveConnection & { platform: SocialPlatform } => connection.platform !== 'facebook'), [connections]);",
  'publishable known accounts',
);

replaceOnce(
  '    const destinations = destinationPayload(connections, selectedConnectionIds, plannedPlatforms, destinationDrafts);',
  '    const destinations = destinationPayload(publishableConnections, selectedConnectionIds, plannedPlatforms, destinationDrafts);',
  'destination payload',
);

replaceOnce(
`              editingPublication={editingPublication}
              connections={connections}
              selectedIds={selectedConnectionIds}`,
`              editingPublication={editingPublication}
              connections={publishableConnections}
              selectedIds={selectedConnectionIds}`,
  'CreatePage connections',
);

const bootstrapBefore = `        const known = nextBootstrap.connections;
        const connected = known.filter((connection) => connection.status === 'connected');
        setSelectedConnectionIds((current) => {
          const valid = current.filter((id) => known.some((connection) => connection.id === id));
          return valid.length ? valid : connected[0] ? [connected[0].id] : [];
        });`;
const bootstrapAfter = `        const known = nextBootstrap.connections;
        const publishableKnown = known.filter((connection) => connection.platform !== 'facebook');
        const connected = known.filter((connection) => connection.status === 'connected');
        const connectedPublishable = publishableKnown.filter((connection) => connection.status === 'connected');
        setSelectedConnectionIds((current) => {
          const valid = current.filter((id) => publishableKnown.some((connection) => connection.id === id));
          return valid.length ? valid : connectedPublishable[0] ? [connectedPublishable[0].id] : [];
        });`;
if (source.includes(bootstrapBefore)) {
  source = source.replace(bootstrapBefore, bootstrapAfter);
}

const resetBefore = `    setSelectedConnectionIds(activeAccountId !== 'all'
      ? [activeAccountId]
      : connectedConnections[0] ? [connectedConnections[0].id] : []);`;
const resetAfter = `    const firstConnectedPublishable = publishableConnections.find((connection) => connection.status === 'connected');
    setSelectedConnectionIds(activeAccountId !== 'all' && activeConnection?.platform !== 'facebook'
      ? [activeAccountId]
      : firstConnectedPublishable ? [firstConnectedPublishable.id] : []);`;
if (source.includes(resetBefore)) source = source.replace(resetBefore, resetAfter);

source += '\n/* sc14-meta-publishable-fix */\n';
fs.writeFileSync(path, source);
console.log('Facebook isolated from the publication composer while remaining visible as a connected account.');
