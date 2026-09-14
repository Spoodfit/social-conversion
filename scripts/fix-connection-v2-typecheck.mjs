import fs from 'node:fs';

const oauthPath = 'src/worker/social-account-oauth.ts';
let oauth = fs.readFileSync(oauthPath, 'utf8');

if (oauth.includes('SOCIAL_OAUTH_PERSISTENCE_V2')) {
  oauth = oauth.replace(
    '\nasync function completeSocialOAuth(\n',
    '\nexport async function completeSocialOAuth(\n',
  );
  oauth = oauth.replace(
    'return { workspaceId: state.workspace_id, connectionId: completed.connectionId, provider, ...completed };',
    'return { workspaceId: state.workspace_id, provider, ...completed };',
  );
  fs.writeFileSync(oauthPath, oauth);
}

const livePath = 'src/LiveAppV3.tsx';
let live = fs.readFileSync(livePath, 'utf8');
if (live.includes('SC_META_SELECTION_V2')) {
  live = live.replace(
    'setMetaSelectedKeys(payload.assets.length === 1 ? [payload.assets[0].key] : []);',
    'setMetaSelectedKeys(payload.assets.length === 1 && payload.assets[0] ? [payload.assets[0].key] : []);',
  );
  fs.writeFileSync(livePath, live);
}

console.log('Connection v2 TypeScript fixes applied.');
