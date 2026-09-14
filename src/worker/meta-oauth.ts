import type { WorkspacePrincipal } from './authorization';
import { decryptToken, encryptToken, saveOAuthCredentials, tokenKeyringSecret } from './token-vault';

const fallbackMetaScopes = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
] as const;

export type MetaRequestedPlatform = 'facebook' | 'instagram';

export type MetaSelectableAsset = {
  key: string;
  platform: MetaRequestedPlatform;
  externalAccountId: string;
  displayName: string;
  handle?: string;
};

type MetaConfig = {
  appId: string;
  appSecret: string;
  configId: string;
  redirectUri: string;
  graphVersion: string;
  keyring: string;
};

type MetaStateRow = {
  id: string;
  workspace_id: string;
  member_id: string;
  actor_subject: string;
  connection_id: string;
  redirect_uri: string;
  expires_at: string;
};

type MetaSelectionRow = {
  id: string;
  workspace_id: string;
  member_id: string;
  actor_subject: string;
  requested_platform: MetaRequestedPlatform;
  user_token_ciphertext: string;
  user_token_iv: string;
  user_key_version: string;
  scopes_json: string;
  expires_at: string;
  completed_at: string | null;
};

type MetaPage = {
  id?: unknown;
  name?: unknown;
  username?: unknown;
  access_token?: unknown;
  instagram_business_account?: {
    id?: unknown;
    username?: unknown;
    name?: unknown;
    profile_picture_url?: unknown;
  } | null;
};

export class MetaOAuthError extends Error {
  readonly code:
    | 'OAUTH_NOT_CONFIGURED'
    | 'INVALID_OAUTH_STATE'
    | 'OAUTH_STATE_EXPIRED'
    | 'OAUTH_PROVIDER_FAILED'
    | 'OAUTH_PROFILE_INVALID'
    | 'OAUTH_STORAGE_FAILED'
    | 'SELECTION_NOT_FOUND'
    | 'SELECTION_EXPIRED'
    | 'INVALID_SELECTION';

  constructor(code: MetaOAuthError['code'], message: string) {
    super(message);
    this.name = 'MetaOAuthError';
    this.code = code;
  }
}

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validHttps(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function metaConfig(env: Env): MetaConfig | undefined {
  const appId = envString(env, 'META_APP_ID');
  const appSecret = envString(env, 'META_APP_SECRET');
  const configId = envString(env, 'META_LOGIN_CONFIG_ID');
  const redirectUri = envString(env, 'META_REDIRECT_URI');
  const graphVersion = envString(env, 'META_GRAPH_VERSION');
  const keyring = tokenKeyringSecret(env);
  if (!appId || !/^\d{5,40}$/.test(appId)) return undefined;
  if (!appSecret || !configId || !/^\d{5,40}$/.test(configId) || !validHttps(redirectUri) || !keyring) return undefined;
  if (!graphVersion || !/^v\d{1,3}\.\d{1,2}$/.test(graphVersion)) return undefined;
  return { appId, appSecret, configId, redirectUri, graphVersion, keyring };
}

export function metaOAuthConfigured(env: Env): boolean {
  return Boolean(metaConfig(env));
}

function requestedPlatformFromState(connectionId: string): MetaRequestedPlatform {
  if (connectionId.startsWith('meta:instagram:')) return 'instagram';
  return 'facebook';
}

function parseScopes(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [];
  } catch {
    return [];
  }
}

async function fetchJson(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      console.warn(JSON.stringify({ event: 'meta_oauth_provider_failed', origin: new URL(url).origin, status: response.status }));
      throw new MetaOAuthError('OAUTH_PROVIDER_FAILED', `Meta provider request failed with HTTP ${response.status}.`);
    }
    try {
      return await response.json();
    } catch {
      throw new MetaOAuthError('OAUTH_PROVIDER_FAILED', 'Meta provider returned invalid JSON.');
    }
  } catch (error) {
    if (error instanceof MetaOAuthError) throw error;
    throw new MetaOAuthError('OAUTH_PROVIDER_FAILED', 'Meta provider request could not be completed.');
  } finally {
    clearTimeout(timeout);
  }
}

async function auditMeta(
  db: D1Database,
  input: { workspaceId: string; actorSubject: string; resourceId: string },
  action: string,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  try {
    await db.prepare(
      `INSERT INTO audit_logs
        (id, workspace_id, actor_id, action, resource_type, resource_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'social_connection', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.workspaceId,
      input.actorSubject,
      action,
      input.resourceId,
      JSON.stringify(metadata),
      new Date().toISOString(),
    ).run();
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'meta_oauth_audit_failed',
      action,
      message: error instanceof Error ? error.message : 'unknown',
    }));
  }
}

export async function startMetaOAuth(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
  requestedPlatform: MetaRequestedPlatform = 'facebook',
) {
  const config = metaConfig(env);
  if (!config) throw new MetaOAuthError('OAUTH_NOT_CONFIGURED', 'Meta OAuth is not configured.');

  const state = crypto.randomUUID();
  const sessionId = `meta:${requestedPlatform}:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  try {
    await db.prepare(
      `INSERT INTO meta_oauth_states
        (id, workspace_id, member_id, actor_subject, connection_id, redirect_uri, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      state,
      principal.workspaceId,
      principal.memberId,
      principal.subject,
      sessionId,
      config.redirectUri,
      expiresAt,
      now,
    ).run();
  } catch (error) {
    console.error(JSON.stringify({ event: 'meta_oauth_state_store_failed', message: error instanceof Error ? error.message : 'unknown' }));
    throw new MetaOAuthError('OAUTH_STORAGE_FAILED', 'Meta authorization could not be initialized.');
  }

  const authorize = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  authorize.searchParams.set('client_id', config.appId);
  authorize.searchParams.set('redirect_uri', config.redirectUri);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('config_id', config.configId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('override_default_response_type', 'true');
  authorize.searchParams.set('auth_type', 'rerequest');

  await auditMeta(db, {
    workspaceId: principal.workspaceId,
    actorSubject: principal.subject,
    resourceId: sessionId,
  }, 'oauth.meta_started', { expiresInSeconds: 600, requestedPlatform });

  return { url: authorize.toString(), expiresAt, requestedPlatform };
}

async function consumeState(db: D1Database, state: string): Promise<MetaStateRow> {
  if (!/^[0-9a-f-]{36}$/i.test(state)) throw new MetaOAuthError('INVALID_OAUTH_STATE', 'Meta OAuth state is invalid.');
  const now = new Date().toISOString();
  const row = await db.prepare(
    `UPDATE meta_oauth_states SET consumed_at = ?
     WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
     RETURNING id, workspace_id, member_id, actor_subject, connection_id, redirect_uri, expires_at`,
  ).bind(now, state, now).first<MetaStateRow>();
  if (row) return row;
  const existing = await db.prepare(
    `SELECT expires_at, consumed_at FROM meta_oauth_states WHERE id = ?`,
  ).bind(state).first<{ expires_at: string; consumed_at: string | null }>();
  if (existing && !existing.consumed_at && existing.expires_at <= now) {
    throw new MetaOAuthError('OAUTH_STATE_EXPIRED', 'Meta OAuth state has expired.');
  }
  throw new MetaOAuthError('INVALID_OAUTH_STATE', 'Meta OAuth state is invalid or already used.');
}

async function grantedPermissions(config: MetaConfig, userToken: string, fetchImpl: typeof fetch): Promise<string[]> {
  try {
    const url = new URL(`https://graph.facebook.com/${config.graphVersion}/me/permissions`);
    const payload = await fetchJson(fetchImpl, url.toString(), {
      headers: { authorization: `Bearer ${userToken}` },
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
  const initial = new URL(`https://graph.facebook.com/${config.graphVersion}/me/accounts`);
  initial.searchParams.set('fields', 'id,name,username,access_token,instagram_business_account{id,username,name,profile_picture_url}');
  initial.searchParams.set('limit', '100');
  let next: string | undefined = initial.toString();
  const pages: MetaPage[] = [];
  for (let page = 0; next && page < 10; page += 1) {
    const payload = await fetchJson(fetchImpl, next, {
      headers: { authorization: `Bearer ${userToken}` },
    }) as { data?: MetaPage[]; paging?: { next?: unknown } };
    if (Array.isArray(payload.data)) pages.push(...payload.data);
    next = typeof payload.paging?.next === 'string' && payload.paging.next.startsWith('https://')
      ? payload.paging.next
      : undefined;
  }
  return pages;
}

function selectableAssets(pages: MetaPage[], requestedPlatform: MetaRequestedPlatform): MetaSelectableAsset[] {
  const assets: MetaSelectableAsset[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const pageId = typeof page.id === 'string' ? page.id.trim() : '';
    const pageName = typeof page.name === 'string' ? page.name.trim() : '';
    const pageToken = typeof page.access_token === 'string' ? page.access_token.trim() : '';
    if (!pageId || !pageName || !pageToken) continue;

    if (requestedPlatform === 'facebook') {
      const key = `facebook:${pageId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const username = typeof page.username === 'string' ? page.username.trim() : '';
      assets.push({
        key,
        platform: 'facebook',
        externalAccountId: pageId,
        displayName: pageName,
        handle: username ? `@${username}` : undefined,
      });
      continue;
    }

    const instagram = page.instagram_business_account;
    const instagramId = typeof instagram?.id === 'string' ? instagram.id.trim() : '';
    if (!instagramId) continue;
    const key = `instagram:${instagramId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const username = typeof instagram?.username === 'string' ? instagram.username.trim() : '';
    const name = typeof instagram?.name === 'string' ? instagram.name.trim() : '';
    assets.push({
      key,
      platform: 'instagram',
      externalAccountId: instagramId,
      displayName: username || name || pageName,
      handle: username ? `@${username}` : undefined,
    });
  }
  return assets;
}

async function saveSelectionSession(
  db: D1Database,
  config: MetaConfig,
  state: MetaStateRow,
  requestedPlatform: MetaRequestedPlatform,
  userToken: string,
  scopes: string[],
): Promise<string> {
  const selectionId = crypto.randomUUID();
  const contextConnectionId = `meta-selection:${selectionId}`;
  const encrypted = await encryptToken(config.keyring, userToken, {
    workspaceId: state.workspace_id,
    connectionId: contextConnectionId,
    provider: 'facebook',
    kind: 'access',
  });
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  await db.prepare(
    `INSERT INTO meta_asset_selections
      (id, workspace_id, member_id, actor_subject, requested_platform,
       user_token_ciphertext, user_token_iv, user_key_version, scopes_json,
       expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    selectionId,
    state.workspace_id,
    state.member_id,
    state.actor_subject,
    requestedPlatform,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.keyVersion,
    JSON.stringify([...new Set(scopes)].sort()),
    expiresAt,
    now,
  ).run();
  return selectionId;
}

async function selectionRow(
  db: D1Database,
  principal: WorkspacePrincipal,
  selectionId: string,
): Promise<MetaSelectionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(selectionId)) {
    throw new MetaOAuthError('SELECTION_NOT_FOUND', 'Meta account selection was not found.');
  }
  const row = await db.prepare(
    `SELECT id, workspace_id, member_id, actor_subject, requested_platform,
            user_token_ciphertext, user_token_iv, user_key_version, scopes_json,
            expires_at, completed_at
     FROM meta_asset_selections
     WHERE id = ? AND workspace_id = ? AND actor_subject = ?`,
  ).bind(selectionId, principal.workspaceId, principal.subject).first<MetaSelectionRow>();
  if (!row || row.completed_at) throw new MetaOAuthError('SELECTION_NOT_FOUND', 'Meta account selection was not found or is already complete.');
  if (row.expires_at <= new Date().toISOString()) throw new MetaOAuthError('SELECTION_EXPIRED', 'Meta account selection has expired. Please reconnect.');
  return row;
}

async function selectionToken(config: MetaConfig, row: MetaSelectionRow): Promise<string> {
  return decryptToken(config.keyring, {
    ciphertext: row.user_token_ciphertext,
    iv: row.user_token_iv,
    keyVersion: row.user_key_version,
  }, {
    workspaceId: row.workspace_id,
    connectionId: `meta-selection:${row.id}`,
    provider: 'facebook',
    kind: 'access',
  });
}

async function upsertInstagramAsset(
  db: D1Database,
  config: MetaConfig,
  row: MetaSelectionRow,
  input: { externalAccountId: string; displayName: string; handle?: string; token: string; scopes: string[] },
): Promise<string> {
  const existing = await db.prepare(
    `SELECT id FROM social_connections
     WHERE workspace_id = ? AND platform = 'instagram' AND external_account_id = ?
     ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
  ).bind(row.workspace_id, input.externalAccountId).first<{ id: string }>();
  const connectionId = existing?.id ?? `igmeta:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const capabilities = {
    publishing: false,
    publishingAuthorized: input.scopes.includes('instagram_content_publish'),
    commentsAuthorized: input.scopes.includes('instagram_basic'),
    authScheme: 'meta',
    direct_messages: false,
  };

  if (existing) {
    await db.prepare(
      `UPDATE social_connections
       SET display_name = ?, handle = ?, status = 'connected', capabilities_json = ?, last_synced_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(`Instagram · ${input.displayName}`, input.handle ?? null, JSON.stringify(capabilities), now, now, connectionId, row.workspace_id).run();
  } else {
    await db.prepare(
      `INSERT INTO social_connections
        (id, workspace_id, platform, external_account_id, display_name, handle, status, capabilities_json, last_synced_at, created_at, updated_at)
       VALUES (?, ?, 'instagram', ?, ?, ?, 'connected', ?, ?, ?, ?)`,
    ).bind(
      connectionId,
      row.workspace_id,
      input.externalAccountId,
      `Instagram · ${input.displayName}`,
      input.handle ?? null,
      JSON.stringify(capabilities),
      now,
      now,
      now,
    ).run();
  }

  await saveOAuthCredentials(db, config.keyring, {
    workspaceId: row.workspace_id,
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
  row: MetaSelectionRow,
  input: { externalAccountId: string; displayName: string; handle?: string; token: string; scopes: string[] },
): Promise<string> {
  const existing = await db.prepare(
    `SELECT id FROM facebook_connections
     WHERE workspace_id = ? AND external_account_id = ? LIMIT 1`,
  ).bind(row.workspace_id, input.externalAccountId).first<{ id: string }>();
  const connectionId = existing?.id ?? `fb:${crypto.randomUUID()}`;
  const encrypted = await encryptToken(config.keyring, input.token, {
    workspaceId: row.workspace_id,
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
    `INSERT INTO facebook_connections
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
       updated_at = excluded.updated_at`,
  ).bind(
    connectionId,
    row.workspace_id,
    input.externalAccountId,
    `Facebook · ${input.displayName}`,
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

export async function completeMetaOAuth(
  db: D1Database,
  env: Env,
  input: { state: string; code: string },
  fetchImpl: typeof fetch = fetch,
) {
  const config = metaConfig(env);
  if (!config) throw new MetaOAuthError('OAUTH_NOT_CONFIGURED', 'Meta OAuth is not configured.');
  if (!input.code || input.code.length > 4096) throw new MetaOAuthError('OAUTH_PROVIDER_FAILED', 'Meta authorization code is invalid.');
  const state = await consumeState(db, input.state);
  if (state.redirect_uri !== config.redirectUri) throw new MetaOAuthError('INVALID_OAUTH_STATE', 'Meta OAuth redirect configuration changed during authorization.');

  const tokenUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', config.appId);
  tokenUrl.searchParams.set('client_secret', config.appSecret);
  tokenUrl.searchParams.set('redirect_uri', config.redirectUri);
  tokenUrl.searchParams.set('code', input.code);
  const shortToken = await fetchJson(fetchImpl, tokenUrl.toString()) as { access_token?: unknown };
  if (typeof shortToken.access_token !== 'string' || !shortToken.access_token) {
    throw new MetaOAuthError('OAUTH_PROVIDER_FAILED', 'Meta did not return an access token.');
  }

  const longUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
  longUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longUrl.searchParams.set('client_id', config.appId);
  longUrl.searchParams.set('client_secret', config.appSecret);
  longUrl.searchParams.set('fb_exchange_token', shortToken.access_token);
  const longTokenPayload = await fetchJson(fetchImpl, longUrl.toString()).catch(() => shortToken) as { access_token?: unknown };
  const userToken = typeof longTokenPayload.access_token === 'string' && longTokenPayload.access_token
    ? longTokenPayload.access_token
    : shortToken.access_token;

  const requestedPlatform = requestedPlatformFromState(state.connection_id);
  const scopes = await grantedPermissions(config, userToken, fetchImpl);
  const pages = await listPages(config, userToken, fetchImpl);
  const assets = selectableAssets(pages, requestedPlatform);
  if (!assets.length) {
    throw new MetaOAuthError(
      'OAUTH_PROFILE_INVALID',
      requestedPlatform === 'facebook'
        ? 'Meta did not return any Facebook Page accessible to this account.'
        : 'Meta did not return any Instagram professional account accessible to this account.',
    );
  }

  const selectionId = await saveSelectionSession(db, config, state, requestedPlatform, userToken, scopes);
  await auditMeta(db, {
    workspaceId: state.workspace_id,
    actorSubject: state.actor_subject,
    resourceId: selectionId,
  }, 'oauth.meta_authorized', { requestedPlatform, availableCount: assets.length });

  return { workspaceId: state.workspace_id, selectionId, requestedPlatform, availableCount: assets.length };
}

export async function getMetaSelection(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
  selectionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ selectionId: string; platform: MetaRequestedPlatform; assets: MetaSelectableAsset[] }> {
  const config = metaConfig(env);
  if (!config) throw new MetaOAuthError('OAUTH_NOT_CONFIGURED', 'Meta OAuth is not configured.');
  const row = await selectionRow(db, principal, selectionId);
  const userToken = await selectionToken(config, row);
  const pages = await listPages(config, userToken, fetchImpl);
  return {
    selectionId: row.id,
    platform: row.requested_platform,
    assets: selectableAssets(pages, row.requested_platform),
  };
}

export async function completeMetaSelection(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
  selectionId: string,
  assetKeys: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ connectedCount: number; connectionIds: string[] }> {
  const config = metaConfig(env);
  if (!config) throw new MetaOAuthError('OAUTH_NOT_CONFIGURED', 'Meta OAuth is not configured.');
  const uniqueKeys = [...new Set(assetKeys.map((key) => key.trim()).filter(Boolean))];
  if (!uniqueKeys.length || uniqueKeys.length > 100) {
    throw new MetaOAuthError('INVALID_SELECTION', 'Choose at least one Meta account to connect.');
  }

  const row = await selectionRow(db, principal, selectionId);
  const userToken = await selectionToken(config, row);
  const pages = await listPages(config, userToken, fetchImpl);
  const allowed = new Map(selectableAssets(pages, row.requested_platform).map((asset) => [asset.key, asset]));
  if (uniqueKeys.some((key) => !allowed.has(key))) {
    throw new MetaOAuthError('INVALID_SELECTION', 'One or more selected Meta accounts are no longer available.');
  }
  const scopes = parseScopes(row.scopes_json);
  const connectionIds: string[] = [];

  for (const key of uniqueKeys) {
    const asset = allowed.get(key);
    if (!asset) continue;
    if (asset.platform === 'facebook') {
      const page = pages.find((candidate) => typeof candidate.id === 'string' && candidate.id.trim() === asset.externalAccountId);
      const pageToken = typeof page?.access_token === 'string' ? page.access_token.trim() : '';
      if (!pageToken) throw new MetaOAuthError('OAUTH_PROFILE_INVALID', 'A selected Facebook Page no longer has a usable authorization token.');
      connectionIds.push(await upsertFacebookAsset(db, config, row, {
        externalAccountId: asset.externalAccountId,
        displayName: asset.displayName,
        handle: asset.handle,
        token: pageToken,
        scopes,
      }));
      continue;
    }

    let matchedPage: MetaPage | undefined;
    for (const page of pages) {
      const instagramId = typeof page.instagram_business_account?.id === 'string' ? page.instagram_business_account.id.trim() : '';
      if (instagramId === asset.externalAccountId) {
        matchedPage = page;
        break;
      }
    }
    const pageToken = typeof matchedPage?.access_token === 'string' ? matchedPage.access_token.trim() : '';
    if (!pageToken) throw new MetaOAuthError('OAUTH_PROFILE_INVALID', 'A selected Instagram account no longer has a usable authorization token.');
    connectionIds.push(await upsertInstagramAsset(db, config, row, {
      externalAccountId: asset.externalAccountId,
      displayName: asset.displayName,
      handle: asset.handle,
      token: pageToken,
      scopes,
    }));
  }

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE meta_asset_selections SET completed_at = ? WHERE id = ? AND completed_at IS NULL`,
  ).bind(now, row.id).run();
  await auditMeta(db, {
    workspaceId: row.workspace_id,
    actorSubject: row.actor_subject,
    resourceId: row.id,
  }, 'oauth.meta_selection_completed', { requestedPlatform: row.requested_platform, connectedCount: connectionIds.length });

  return { connectedCount: connectionIds.length, connectionIds };
}

// META_SELECTION_V2
