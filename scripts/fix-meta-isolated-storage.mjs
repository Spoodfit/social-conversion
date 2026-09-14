import fs from 'node:fs';

const metaPath = 'src/worker/meta-oauth.ts';
let meta = fs.readFileSync(metaPath, 'utf8');

if (!meta.includes('META_ISOLATED_FACEBOOK_STORAGE')) {
  meta = meta.replace(
    "import { saveOAuthCredentials, tokenKeyringSecret } from './token-vault';",
    "import { encryptToken, saveOAuthCredentials, tokenKeyringSecret } from './token-vault';",
  );
  meta = meta.replaceAll('oauth_states', 'meta_oauth_states');

  const start = meta.indexOf('async function findExistingConnection(');
  const end = meta.indexOf('export async function completeMetaOAuth(', start);
  if (start < 0 || end < 0) throw new Error('Meta isolated storage patch could not locate account upsert functions.');

  const replacement = `async function findExistingInstagramConnection(
  db: D1Database,
  workspaceId: string,
  externalAccountId: string,
): Promise<string | undefined> {
  const row = await db.prepare(
    \`SELECT id FROM social_connections
     WHERE workspace_id = ? AND platform = 'instagram' AND external_account_id = ? AND id LIKE 'igmeta:%'
     ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1\`,
  ).bind(workspaceId, externalAccountId).first<{ id: string }>();
  return row?.id;
}

async function upsertInstagramAsset(
  db: D1Database,
  config: MetaConfig,
  state: MetaStateRow,
  input: {
    externalAccountId: string;
    displayName: string;
    handle?: string;
    token: string;
    scopes: string[];
  },
): Promise<string> {
  const existingId = await findExistingInstagramConnection(db, state.workspace_id, input.externalAccountId);
  const connectionId = existingId ?? \`igmeta:\${crypto.randomUUID()}\`;
  const now = new Date().toISOString();
  const capabilities = {
    publishing: false,
    publishingAuthorized: input.scopes.includes('instagram_content_publish'),
    commentsAuthorized: input.scopes.includes('instagram_basic'),
    authScheme: 'meta',
    direct_messages: false,
  };

  if (existingId) {
    await db.prepare(
      \`UPDATE social_connections
       SET display_name = ?, handle = ?, status = 'connected', capabilities_json = ?, last_synced_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?\`,
    ).bind(input.displayName, input.handle ?? null, JSON.stringify(capabilities), now, now, connectionId, state.workspace_id).run();
  } else {
    await db.prepare(
      \`INSERT INTO social_connections
        (id, workspace_id, platform, external_account_id, display_name, handle, status, capabilities_json, last_synced_at, created_at, updated_at)
       VALUES (?, ?, 'instagram', ?, ?, ?, 'connected', ?, ?, ?, ?)\`,
    ).bind(
      connectionId,
      state.workspace_id,
      input.externalAccountId,
      input.displayName,
      input.handle ?? null,
      JSON.stringify(capabilities),
      now,
      now,
      now,
    ).run();
  }

  await saveOAuthCredentials(db, config.keyring, {
    workspaceId: state.workspace_id,
    connectionId,
    provider: 'instagram',
    accessToken: input.token,
    scopes: input.scopes,
  });
  return connectionId;
}

async function upsertFacebookAsset(
  db: D1Database,
  config: MetaConfig,
  state: MetaStateRow,
  input: {
    externalAccountId: string;
    displayName: string;
    handle?: string;
    token: string;
    scopes: string[];
  },
): Promise<string> {
  const existing = await db.prepare(
    \`SELECT id FROM facebook_connections
     WHERE workspace_id = ? AND external_account_id = ?
     LIMIT 1\`,
  ).bind(state.workspace_id, input.externalAccountId).first<{ id: string }>();
  const connectionId = existing?.id ?? \`fb:\${crypto.randomUUID()}\`;
  const encrypted = await encryptToken(config.keyring, input.token, {
    workspaceId: state.workspace_id,
    connectionId,
    provider: 'facebook',
    kind: 'access',
  });
  const now = new Date().toISOString();
  const capabilities = {
    publishing: false,
    publishingAuthorized: input.scopes.includes('pages_manage_posts'),
    engagementAuthorized: input.scopes.includes('pages_read_engagement'),
    authScheme: 'meta',
    direct_messages: false,
  };

  await db.prepare(
    \`INSERT INTO facebook_connections
      (id, workspace_id, external_account_id, display_name, handle, status, capabilities_json,
       access_token_ciphertext, access_token_iv, access_key_version, scopes_json,
       last_synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, external_account_id) DO UPDATE SET
       display_name = excluded.display_name,
       handle = excluded.handle,
       status = 'connected',
       capabilities_json = excluded.capabilities_json,
       access_token_ciphertext = excluded.access_token_ciphertext,
       access_token_iv = excluded.access_token_iv,
       access_key_version = excluded.access_key_version,
       scopes_json = excluded.scopes_json,
       last_synced_at = excluded.last_synced_at,
       updated_at = excluded.updated_at\`,
  ).bind(
    connectionId,
    state.workspace_id,
    input.externalAccountId,
    input.displayName,
    input.handle ?? null,
    JSON.stringify(capabilities),
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.keyVersion,
    JSON.stringify([...new Set(input.scopes)].sort()),
    now,
    now,
    now,
  ).run();
  return connectionId;
}

async function upsertAsset(
  db: D1Database,
  config: MetaConfig,
  state: MetaStateRow,
  input: {
    platform: 'facebook' | 'instagram';
    externalAccountId: string;
    displayName: string;
    handle?: string;
    token: string;
    scopes: string[];
  },
): Promise<string> {
  if (input.platform === 'facebook') {
    return upsertFacebookAsset(db, config, state, input);
  }
  return upsertInstagramAsset(db, config, state, input);
}

`;

  meta = meta.slice(0, start) + replacement + meta.slice(end);
  meta += '\n// META_ISOLATED_FACEBOOK_STORAGE\n';
  fs.writeFileSync(metaPath, meta);
}

const indexPath = 'src/worker/index.ts';
let index = fs.readFileSync(indexPath, 'utf8');
if (!index.includes('FACEBOOK_CONNECTIONS_UNION')) {
  index = index.replace(
    "  platform: 'instagram' | 'youtube' | 'tiktok';\n  display_name: string;",
    "  platform: 'instagram' | 'facebook' | 'youtube' | 'tiktok';\n  display_name: string;",
  );

  const before = `      \`SELECT id, platform, display_name, handle, status, last_synced_at
       FROM social_connections
       WHERE workspace_id = ?
       ORDER BY platform, display_name\`,
    ).bind(principal.workspaceId),`;
  const after = `      \`SELECT id, platform, display_name, handle, status, last_synced_at
       FROM social_connections
       WHERE workspace_id = ?
       UNION ALL
       SELECT id, 'facebook' AS platform, display_name, handle, status, last_synced_at
       FROM facebook_connections
       WHERE workspace_id = ?
       ORDER BY platform, display_name\`,
    ).bind(principal.workspaceId, principal.workspaceId),`;
  if (!index.includes(before)) throw new Error('Meta isolated storage patch could not locate bootstrap connection query.');
  index = index.replace(before, after);
  index += '\n// FACEBOOK_CONNECTIONS_UNION\n';
  fs.writeFileSync(indexPath, index);
}

console.log('Meta Facebook storage isolated and bootstrap aggregation applied.');
