import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

// The production UI evolved after the original Threads patch. Finalize the generated
// component signatures and routing here, after every native UI patch has run.
source = source.replace(
  'function AccountPanel({ connections, ready, metaReady, linkedinReady, onConnectLinkedIn, onClose, onConnect, onConnectMeta, activeAccountId, onSwitch }: {',
  'function AccountPanel({ connections, ready, metaReady, linkedinReady, onConnectLinkedIn, threadsReady, onConnectThreads, onClose, onConnect, onConnectMeta, activeAccountId, onSwitch }: {',
);
source = source.replace(
  'function SettingsPage({ session, connections, runtime, onConnect, onConnectMeta, onConnectLinkedIn, onConnectLinkedInCommunity, onDisconnect, onRefresh }: {',
  'function SettingsPage({ session, connections, runtime, onConnect, onConnectMeta, onConnectLinkedIn, onConnectThreads, onConnectLinkedInCommunity, onDisconnect, onRefresh }: {',
);
source = source.replace(
  "  onConnectLinkedIn: (id?: string) => void;\n  onConnectLinkedInCommunity: () => void;",
  "  onConnectLinkedIn: (id?: string) => void;\n  onConnectThreads: (id?: string) => void;\n  onConnectLinkedInCommunity: () => void;",
);
source = source.replace(
  '              onConnectLinkedIn={(id) => void connectLinkedIn(id)}\n              onConnectLinkedInCommunity={() => void connectLinkedInCommunity()}',
  '              onConnectLinkedIn={(id) => void connectLinkedIn(id)}\n              onConnectThreads={(id) => void connectThreads(id)}\n              onConnectLinkedInCommunity={() => void connectLinkedInCommunity()}',
);

// Older Facebook generation can reinsert its narrow alias when patch:ui runs a second time.
// Keep one canonical connected-platform union after all legacy patches have executed.
const canonicalConnectedPlatform = "type ConnectedPlatform = SocialPlatform | 'facebook' | 'linkedin' | 'threads';";
source = source.replaceAll("type ConnectedPlatform = SocialPlatform | 'facebook';\n", '');
source = source.replaceAll("type ConnectedPlatform = SocialPlatform | 'facebook' | 'linkedin';\n", '');
const canonicalMatches = source.split(canonicalConnectedPlatform).length - 1;
if (canonicalMatches === 0) {
  source = source.replace(
    "type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';",
    "type SocialPlatform = 'instagram' | 'youtube' | 'tiktok';\n" + canonicalConnectedPlatform,
  );
} else if (canonicalMatches > 1) {
  let kept = false;
  source = source.split('\n').filter((line) => {
    if (line !== canonicalConnectedPlatform) return true;
    if (!kept) {
      kept = true;
      return true;
    }
    return false;
  }).join('\n');
}

// Add Threads routing only when the exact Threads prefix is not already present.
const runtimeReconnectBase = "connection.platform === 'linkedin' ? !runtime.linkedinOAuthReady : connection.platform === 'facebook' ? !runtime.metaOAuthReady : !ready[connection.platform]";
const runtimeReconnectThreads = "connection.platform === 'threads' ? !runtime.threadsOAuthReady : connection.platform === 'linkedin' ? !runtime.linkedinOAuthReady : connection.platform === 'facebook' ? !runtime.metaOAuthReady : !ready[connection.platform as SocialPlatform]";
if (source.includes(runtimeReconnectBase) && !source.includes(runtimeReconnectThreads)) {
  source = source.replaceAll(runtimeReconnectBase, runtimeReconnectThreads);
}

const settingsReconnectBase = "connection.platform === 'linkedin' ? onConnectLinkedIn(connection.id) : connection.platform === 'facebook' ? onConnectMeta('facebook') : onConnect(connection.platform as SocialPlatform, connection.id)";
const settingsReconnectThreads = "connection.platform === 'threads' ? onConnectThreads(connection.id) : connection.platform === 'linkedin' ? onConnectLinkedIn(connection.id) : connection.platform === 'facebook' ? onConnectMeta('facebook') : onConnect(connection.platform as SocialPlatform, connection.id)";
if (source.includes(settingsReconnectBase)) {
  source = source.replaceAll(settingsReconnectBase, settingsReconnectThreads);
}

source = source.replace(
  `  const reconnectAccount = (connection: LiveConnection) => {\n    if (connection.platform === 'linkedin') {`,
  `  const reconnectAccount = (connection: LiveConnection) => {\n    if (connection.platform === 'threads') {\n      if (threadsReady) onConnectThreads(connection.id);\n      return;\n    }\n    if (connection.platform === 'linkedin') {`,
);

const panelReconnectBase = "connection.platform === 'linkedin' ? !linkedinReady : connection.platform === 'facebook' ? !metaReady : !ready[connection.platform]";
const panelReconnectThreads = "connection.platform === 'threads' ? !threadsReady : connection.platform === 'linkedin' ? !linkedinReady : connection.platform === 'facebook' ? !metaReady : !ready[connection.platform as SocialPlatform]";
if (source.includes(panelReconnectBase)) {
  source = source.replaceAll(panelReconnectBase, panelReconnectThreads);
}

// Current native composer uses an explicit allow-list of PlanningPlatform values. Threads
// must remain connection-only until its publishing adapter is implemented.
source = source.replace(
  'const publishableKnown = known;',
  "const publishableKnown = known.filter((connection) => connection.platform !== 'threads');",
);

// Collapse accidental repeated Threads prefixes left by earlier non-idempotent revisions.
source = source.replace(
  /(connection\.platform === 'threads' \? onConnectThreads\(connection\.id\) : ){2,}/g,
  "connection.platform === 'threads' ? onConnectThreads(connection.id) : ",
);
source = source.replace(
  /(connection\.platform === 'threads' \? !runtime\.threadsOAuthReady : ){2,}/g,
  "connection.platform === 'threads' ? !runtime.threadsOAuthReady : ",
);
source = source.replace(
  /(connection\.platform === 'threads' \? !threadsReady : ){2,}/g,
  "connection.platform === 'threads' ? !threadsReady : ",
);

source = source.replaceAll(
  'Instagram, Facebook, LinkedIn, YouTube ou TikTok',
  'Instagram, Facebook, LinkedIn, Threads, YouTube ou TikTok',
);
source = source.replaceAll(
  'Instagram, Facebook, LinkedIn, Threads, Threads, YouTube ou TikTok',
  'Instagram, Facebook, LinkedIn, Threads, YouTube ou TikTok',
);

const publishableLine = source.split('\n').find((line) => line.includes('const publishableConnections = useMemo')) ?? '';
const legacyIsolation = source.includes("connection.platform !== 'threads'");
const nativeIsolation = Boolean(publishableLine)
  && !publishableLine.includes("connection.platform === 'threads'")
  && publishableLine.includes("connection.platform === 'instagram'")
  && publishableLine.includes("connection.platform === 'tiktok'");

if ((source.split(canonicalConnectedPlatform).length - 1) !== 1) {
  throw new Error('Threads generated UI fix failed: connected platform union is not canonical.');
}
if (!source.includes('linkedinReady, onConnectLinkedIn, threadsReady, onConnectThreads')) {
  throw new Error('Threads generated UI fix failed: AccountPanel does not destructure Threads props.');
}
if (!source.includes('onConnectLinkedIn, onConnectThreads, onConnectLinkedInCommunity')) {
  throw new Error('Threads generated UI fix failed: SettingsPage does not destructure Threads callback.');
}
if (!source.includes("connection.platform === 'threads'")) {
  throw new Error('Threads generated UI fix failed: account routing does not contain Threads.');
}
if (!source.includes('onConnectThreads={(id) => void connectThreads(id)}')) {
  throw new Error('Threads generated UI fix failed: Threads callback is not passed to account UI.');
}
if (!source.includes('threadsReady')) {
  throw new Error('Threads generated UI fix failed: Threads readiness is missing.');
}
if (!legacyIsolation && !nativeIsolation) {
  throw new Error('Threads generated UI fix failed: Threads is not isolated from the composer yet.');
}

source += source.includes('SC_THREADS_UI_GENERATED_V1') ? '' : '\n/* SC_THREADS_UI_GENERATED_V1 */\n';
fs.writeFileSync(path, source);
console.log('Generated Threads account routing finalized for the current production UI.');

await import('./apply-threads-compliance-callbacks.mjs');
