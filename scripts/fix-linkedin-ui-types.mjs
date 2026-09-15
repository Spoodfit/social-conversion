import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');
const original = source;

const canonicalConnectedType = "type ConnectedPlatform = SocialPlatform | 'facebook' | 'linkedin';";
source = source.replace(
  "type ConnectedPlatform = SocialPlatform | 'facebook';\n" + canonicalConnectedType,
  canonicalConnectedType,
);
source = source.replace(
  canonicalConnectedType + "\ntype ConnectedPlatform = SocialPlatform | 'facebook';",
  canonicalConnectedType,
);

if (source.includes('SC_LINKEDIN_UI_TYPES_V2')) {
  if (source !== original) fs.writeFileSync(path, source);
  console.log('LinkedIn UI type routing already finalized.');
  process.exit(0);
}

source = source.replaceAll(
  "onClick={() => connection.platform === 'facebook' ? onConnectMeta('facebook') : onConnect(connection.platform as SocialPlatform, connection.id)}",
  "onClick={() => connection.platform === 'linkedin' ? onConnectLinkedIn(connection.id) : connection.platform === 'facebook' ? onConnectMeta('facebook') : onConnect(connection.platform as SocialPlatform, connection.id)}",
);

source = source.replace(
  "function AccountPanel({ connections, ready, metaReady, onClose, onConnect, onConnectMeta, activeAccountId, onSwitch }: {",
  "function AccountPanel({ connections, ready, metaReady, linkedinReady, onConnectLinkedIn, onClose, onConnect, onConnectMeta, activeAccountId, onSwitch }: {",
);

const reconnectBefore = `  const reconnectAccount = (connection: LiveConnection) => {
    if (connection.platform === 'facebook') {
      if (metaReady) onConnectMeta('facebook');
      return;
    }
    if (ready[connection.platform]) onConnect(connection.platform, connection.id);
  };`;
const reconnectAfter = `  const reconnectAccount = (connection: LiveConnection) => {
    if (connection.platform === 'linkedin') {
      if (linkedinReady) onConnectLinkedIn(connection.id);
      return;
    }
    if (connection.platform === 'facebook') {
      if (metaReady) onConnectMeta('facebook');
      return;
    }
    if (ready[connection.platform]) onConnect(connection.platform, connection.id);
  };`;
if (!source.includes(reconnectBefore)) throw new Error('LinkedIn UI type fix failed: reconnect routing anchor not found.');
source = source.replace(reconnectBefore, reconnectAfter);

source = source.replace(
  "disabled={connection.platform === 'facebook' ? !metaReady : !ready[connection.platform]}",
  "disabled={connection.platform === 'linkedin' ? !linkedinReady : connection.platform === 'facebook' ? !metaReady : !ready[connection.platform]}",
);

source = source.replace(
  "const publishableConnections = useMemo(() => connections.filter((connection): connection is LiveConnection & { platform: SocialPlatform } => connection.platform !== 'facebook'), [connections]);",
  "const publishableConnections = useMemo(() => connections.filter((connection): connection is LiveConnection & { platform: SocialPlatform } => connection.platform !== 'facebook' && connection.platform !== 'linkedin'), [connections]);",
);

source = source.replace(
  "setSelectedConnectionIds(activeAccountId !== 'all' && activeConnection?.platform !== 'facebook'\n      ? [activeAccountId]",
  "setSelectedConnectionIds(activeAccountId !== 'all' && activeConnection?.platform !== 'facebook' && activeConnection?.platform !== 'linkedin'\n      ? [activeAccountId]",
);

const providerListAnchor = '          <div className="sc10-provider-list sc16-provider-list">';
if (!source.includes('providerHint(\'linkedin\'')) {
  if (!source.includes(providerListAnchor)) throw new Error('LinkedIn UI type fix failed: account provider list anchor not found.');
  source = source.replace(
    providerListAnchor,
`${providerListAnchor}
            <button type="button" className="sc20-linkedin-provider" disabled={!linkedinReady} onClick={() => onConnectLinkedIn()}>
              <PlatformMark platform="linkedin" size={19} />
              <span><strong>LinkedIn</strong><small>{linkedinReady ? providerHint('linkedin', 'Ajouter un profil LinkedIn') : 'Configuration LinkedIn requise'}</small></span>
              {linkedinReady ? <ChevronRight size={17} /> : <span className="sc10-wait">À configurer</span>}
            </button>`,
  );
}

source = source.replace(
  'plusieurs comptes Instagram, Facebook, YouTube ou TikTok dans le même espace.',
  'plusieurs comptes Instagram, Facebook, LinkedIn, YouTube ou TikTok dans le même espace.',
);

source += '\n/* SC_LINKEDIN_UI_TYPES_V2 */\n';
fs.writeFileSync(path, source);
console.log('LinkedIn account routing, composer isolation and UI types finalized.');
