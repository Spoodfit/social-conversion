import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

source = source.replaceAll(
  "connection.platform === 'linkedin' ? !runtime.linkedinOAuthReady : connection.platform === 'facebook' ? !runtime.metaOAuthReady : !ready[connection.platform]",
  "connection.platform === 'threads' ? !runtime.threadsOAuthReady : connection.platform === 'linkedin' ? !runtime.linkedinOAuthReady : connection.platform === 'facebook' ? !runtime.metaOAuthReady : !ready[connection.platform as SocialPlatform]",
);
source = source.replaceAll(
  "connection.platform === 'linkedin' ? onConnectLinkedIn(connection.id) : connection.platform === 'facebook' ? onConnectMeta('facebook') : onConnect(connection.platform as SocialPlatform, connection.id)",
  "connection.platform === 'threads' ? onConnectThreads(connection.id) : connection.platform === 'linkedin' ? onConnectLinkedIn(connection.id) : connection.platform === 'facebook' ? onConnectMeta('facebook') : onConnect(connection.platform as SocialPlatform, connection.id)",
);
source = source.replace(
  `  const reconnectAccount = (connection: LiveConnection) => {\n    if (connection.platform === 'linkedin') {`,
  `  const reconnectAccount = (connection: LiveConnection) => {\n    if (connection.platform === 'threads') {\n      if (threadsReady) onConnectThreads(connection.id);\n      return;\n    }\n    if (connection.platform === 'linkedin') {`,
);
source = source.replaceAll(
  "connection.platform === 'linkedin' ? !linkedinReady : connection.platform === 'facebook' ? !metaReady : !ready[connection.platform]",
  "connection.platform === 'threads' ? !threadsReady : connection.platform === 'linkedin' ? !linkedinReady : connection.platform === 'facebook' ? !metaReady : !ready[connection.platform as SocialPlatform]",
);
source = source.replaceAll(
  'Instagram, Facebook, LinkedIn, YouTube ou TikTok',
  'Instagram, Facebook, LinkedIn, Threads, YouTube ou TikTok',
);

if (!source.includes("connection.platform === 'threads'")) {
  throw new Error('Threads generated UI fix failed: account routing does not contain Threads.');
}
if (!source.includes('onConnectThreads')) {
  throw new Error('Threads generated UI fix failed: Threads connect callback is missing.');
}
if (!source.includes('threadsReady')) {
  throw new Error('Threads generated UI fix failed: Threads readiness is missing.');
}
if (!source.includes("connection.platform !== 'threads'")) {
  throw new Error('Threads generated UI fix failed: Threads is not isolated from the composer yet.');
}

source += source.includes('SC_THREADS_UI_GENERATED_V1') ? '' : '\n/* SC_THREADS_UI_GENERATED_V1 */\n';
fs.writeFileSync(path, source);
console.log('Generated Threads account routing finalized.');
