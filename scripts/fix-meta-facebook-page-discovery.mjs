import fs from 'node:fs';

const path = 'src/worker/meta-oauth.ts';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Facebook Meta discovery patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

replaceOnce(
`async function grantedPermissions(config: MetaConfig, userToken: string, fetchImpl: typeof fetch): Promise<string[]> {
  try {
    const url = new URL(\`https://graph.facebook.com/\${config.graphVersion}/me/permissions\`);
    const payload = await fetchJson(fetchImpl, url.toString(), {
      headers: { authorization: \`Bearer \${userToken}\` },
    }) as { data?: Array<{ permission?: unknown; status?: unknown }> };
    const granted = Array.isArray(payload.data)
      ? payload.data
        .filter((entry) => entry.status === 'granted' && typeof entry.permission === 'string')
        .map((entry) => String(entry.permission))
      : [];
    return granted.length ? [...new Set(granted)].sort() : [...fallbackMetaScopes];
  } catch {
    return [...fallbackMetaScopes];
  }
}

async function listPages(config: MetaConfig, userToken: string, fetchImpl: typeof fetch): Promise<MetaPage[]> {
  const initial = new URL(\`https://graph.facebook.com/\${config.graphVersion}/me/accounts\`);
  initial.searchParams.set('fields', 'id,name,username,access_token,instagram_business_account{id,username,name,profile_picture_url}');`,
`async function grantedPermissions(
  config: MetaConfig,
  userToken: string,
  requestedPlatform: MetaRequestedPlatform,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  try {
    const url = new URL(\`https://graph.facebook.com/\${config.graphVersion}/me/permissions\`);
    const payload = await fetchJson(fetchImpl, url.toString(), {
      headers: { authorization: \`Bearer \${userToken}\` },
    }) as { data?: Array<{ permission?: unknown; status?: unknown }> };
    const granted = Array.isArray(payload.data)
      ? payload.data
        .filter((entry) => entry.status === 'granted' && typeof entry.permission === 'string')
        .map((entry) => String(entry.permission))
      : [];
    if (granted.length) return [...new Set(granted)].sort();
    return requestedPlatform === 'facebook'
      ? ['pages_show_list', 'pages_read_engagement']
      : [...fallbackMetaScopes];
  } catch {
    return requestedPlatform === 'facebook'
      ? ['pages_show_list', 'pages_read_engagement']
      : [...fallbackMetaScopes];
  }
}

async function listPages(
  config: MetaConfig,
  userToken: string,
  requestedPlatform: MetaRequestedPlatform,
  fetchImpl: typeof fetch,
): Promise<MetaPage[]> {
  const initial = new URL(\`https://graph.facebook.com/\${config.graphVersion}/me/accounts\`);
  initial.searchParams.set(
    'fields',
    requestedPlatform === 'facebook'
      ? 'id,name,access_token'
      : 'id,name,username,access_token,instagram_business_account{id,username,name,profile_picture_url}',
  );`,
  'platform-specific permissions and fields',
);

replaceOnce(
`  const requestedPlatform = requestedPlatformFromState(state.connection_id);
  const scopes = await grantedPermissions(config, userToken, fetchImpl);
  const pages = await listPages(config, userToken, fetchImpl);`,
`  const requestedPlatform = requestedPlatformFromState(state.connection_id);
  const scopes = await grantedPermissions(config, userToken, requestedPlatform, fetchImpl);
  const pages = await listPages(config, userToken, requestedPlatform, fetchImpl);`,
  'callback Facebook Page lookup',
);

replaceOnce(
`  const row = await selectionRow(db, principal, selectionId);
  const userToken = await selectionToken(config, row);
  const pages = await listPages(config, userToken, fetchImpl);
  return {`,
`  const row = await selectionRow(db, principal, selectionId);
  const userToken = await selectionToken(config, row);
  const pages = await listPages(config, userToken, row.requested_platform, fetchImpl);
  return {`,
  'selection Page lookup',
);

replaceOnce(
`  const row = await selectionRow(db, principal, selectionId);
  const userToken = await selectionToken(config, row);
  const pages = await listPages(config, userToken, fetchImpl);
  const allowed = new Map(selectableAssets(pages, row.requested_platform).map((asset) => [asset.key, asset]));`,
`  const row = await selectionRow(db, principal, selectionId);
  const userToken = await selectionToken(config, row);
  const pages = await listPages(config, userToken, row.requested_platform, fetchImpl);
  const allowed = new Map(selectableAssets(pages, row.requested_platform).map((asset) => [asset.key, asset]));`,
  'completion Page lookup',
);

if (!source.includes('// META_FACEBOOK_PAGE_DISCOVERY_V1')) {
  source += '\n// META_FACEBOOK_PAGE_DISCOVERY_V1\n';
}

fs.writeFileSync(path, source);
