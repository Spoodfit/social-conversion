import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('SC_INSTAGRAM_DIRECT_OAUTH_FIX')) {
  console.log('Instagram direct OAuth routing already applied.');
  process.exit(0);
}

const original = source;

// Instagram must use the dedicated Instagram Login flow, not Facebook Login for Business.
source = source.replaceAll(
  "onClick={() => onConnectMeta('instagram')}",
  "onClick={() => onConnect('instagram')}",
);

// Settings page readiness must follow the Instagram provider configuration.
source = source.replaceAll(
  "disabled={!runtime.metaOAuthReady} onClick={() => onConnect('instagram')}",
  "disabled={!runtime.instagramOAuthReady} onClick={() => onConnect('instagram')}",
);
source = source.replaceAll(
  "{runtime.metaOAuthReady ? 'Choisir un ou plusieurs comptes professionnels' : 'Configuration Meta requise'}",
  "{runtime.instagramOAuthReady ? 'Connexion directe au compte professionnel' : 'Configuration Instagram requise'}",
);

// Account panel receives the per-provider readiness map.
source = source.replaceAll(
  "disabled={!metaReady} onClick={() => onConnect('instagram')}",
  "disabled={!ready.instagram} onClick={() => onConnect('instagram')}",
);
source = source.replaceAll(
  "{metaReady ? 'Choisir un ou plusieurs comptes professionnels' : 'Configuration Meta requise'}",
  "{ready.instagram ? 'Connexion directe au compte professionnel' : 'Configuration Instagram requise'}",
);
source = source.replaceAll(
  "{metaReady ? <ChevronRight size={17} /> : <span className=\"sc10-wait\">Bientôt</span>}",
  "{ready.instagram ? <ChevronRight size={17} /> : <span className=\"sc10-wait\">Bientôt</span>}",
);

// Reconnect Instagram through its own OAuth route. Facebook remains on Meta OAuth.
source = source.replaceAll(
  "connection.platform === 'facebook' || (connection.platform === 'instagram' && runtime.metaOAuthReady) ? onConnectMeta(connection.platform as 'facebook' | 'instagram') : onConnect(connection.platform as SocialPlatform, connection.id)",
  "connection.platform === 'facebook' ? onConnectMeta('facebook') : onConnect(connection.platform as SocialPlatform, connection.id)",
);
source = source.replaceAll(
  "connection.platform === 'facebook' || (connection.platform === 'instagram' && metaReady) ? metaReady && onConnectMeta(connection.platform as 'facebook' | 'instagram') : ready[connection.platform as SocialPlatform] && onConnect(connection.platform as SocialPlatform, connection.id)",
  "connection.platform === 'facebook' ? metaReady && onConnectMeta('facebook') : ready[connection.platform as SocialPlatform] && onConnect(connection.platform as SocialPlatform, connection.id)",
);

if (source === original) {
  throw new Error('Instagram direct OAuth fix did not find any transformed Meta UI anchors.');
}

source += '\n/* SC_INSTAGRAM_DIRECT_OAUTH_FIX */\n';
fs.writeFileSync(path, source);
console.log('Instagram now uses the dedicated Instagram Login OAuth flow.');
