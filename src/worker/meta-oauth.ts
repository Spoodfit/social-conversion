import type { WorkspacePrincipal } from './authorization';
import { saveOAuthCredentials, tokenKeyringSecret } from './token-vault';

const fallbackMetaScopes = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
] as const;

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
    | 'OAUTH_PROFILE_INVALID';

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
  state: Pick<MetaStateRow, 'workspace_id' | 'actor_subject' | 'connection_id'>,
  action: string,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  await db.prepare(
    `INSERT INTO audit_logs
      (id, workspace_id, actor_id, action, resource_type, resource_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'social_connection', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    state.workspace_id,
    state.actor_subject,
    action,
    state.connection_id,
    JSON.stringify(metadata),
    new Date().toISOString(),
  ).run();
}

export async function startMetaOAuth(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
) {
  const config = metaConfig(env);
  if (!config) throw new MetaOAuthError('OAUTH_NOT_CONFIGURED', 'Meta OAuth is not configured.');

  const state = crypto.randomUUID();
  const sessionId = `meta:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.prepare(
    `INSERT INTO oauth_states
      (id, workspace_id, member_id, actor_subject, provider, connection_id, redirect_uri, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'meta', ?, ?, ?, ?)`,
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

  const authorize = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  authorize.searchParams.set('client_id', config.appId);
  authorize.searchParams.set('redirect_uri', config.redirectUri);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('config_id', config.configId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('override_default_response_type', 'true');
  authorize.searchParams.set('auth_type', 'rerequest');

  await auditMeta(db, {
    workspace_id: principal.workspaceId,
    actor_subject: principal.subject,
    connection_id: sessionId,
  }, 'oauth.meta_started', { expiresInSeconds: 600 });

  return { url: authorize.toString(), expiresAt };
}

async function consumeState(db: D1Database, state: string): Promise<MetaStateRow> {
  if (!/^[0-9a-f-]{36}$/i.test(state)) throw new MetaOAuthError('INVALID_OAUTH_STATE', 'Meta OAuth state is invalid.');
  const now = new Date().toISOString();
  const row = await db.prepare(
    `UPDATE oauth_states SET consumed_at = ?
     WHERE id = ? AND provider = 'meta' AND consumed_at IS NULL AND expires_at > ?
     RETURNING id, workspace_id, member_id, actor_subject, connection_id, redirect_uri, expires_at`,
  ).bind(now, state, now).first<MetaStateRow>();
  if (row) return row;
  const existing = await db.prepare(
    `SELECT expires_at, consumed_at FROM oauth_states WHERE id = ? AND provider = 'meta'`,
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

async function findExistingConnection(
  db: D1Database,
  workspaceId: string,
  platform: 'facebook' | 'instagram',
  externalAccountId: string,
): Promise<string | undefined> {
  const row = await db.prepare(
    `SELECT id FROM social_connections
     WHERE workspace_id = ? AND platform = ? AND external_account_id = ?
     ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
  ).bind(workspaceId, platform, externalAccountId).first<{ id: string }>();
  return row?.id;
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
  const existingId = await findExistingConnection(db, state.workspace_id, input.platform, input.externalAccountId);
  const connectionId = existingId ?? `${input.platform === 'facebook' ? 'fb' : 'ig'}:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const capabilities = input.platform === 'facebook'
    ? { publishing: input.scopes.includes('pages_manage_posts'), comments: input.scopes.includes('pages_read_engagement'), direct_messages: false }
    : { publishing: input.scopes.includes('instagram_content_publish'), comments: input.scopes.includes('instagram_basic'), direct_messages: false };

  if (existingId) {
    await db.prepare(
      `UPDATE social_connections
       SET display_name = ?, handle = ?, status = 'connected', capabilities_json = ?, last_synced_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(input.displayName, input.handle ?? null, JSON.stringify(capabilities), now, now, connectionId, state.workspace_id).run();
  } else {
    await db.prepare(
      `INSERT INTO social_connections
        (id, workspace_id, platform, external_account_id, display_name, handle, status, capabilities_json, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?)`,
    ).bind(
      connectionId,
      state.workspace_id,
      input.platform,
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
    provider: input.platform,
    accessToken: input.token,
    scopes: input.scopes,
  });
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

  const scopes = await grantedPermissions(config, userToken, fetchImpl);
  const pages = await listPages(config, userToken, fetchImpl);
  if (!pages.length) {
    throw new MetaOAuthError('OAUTH_PROFILE_INVALID', 'Meta did not return any Facebook Page accessible to this account.');
  }

  const facebookConnectionIds: string[] = [];
  const instagramConnectionIds: string[] = [];
  const seenPages = new Set<string>();
  const seenInstagram = new Set<string>();

  for (const page of pages) {
    const pageId = typeof page.id === 'string' ? page.id.trim() : '';
    const pageName = typeof page.name === 'string' ? page.name.trim() : '';
    const pageToken = typeof page.access_token === 'string' ? page.access_token.trim() : '';
    const pageUsername = typeof page.username === 'string' ? page.username.trim() : '';
    if (!pageId || !pageName || !pageToken || seenPages.has(pageId)) continue;
    seenPages.add(pageId);

    const facebookId = await upsertAsset(db, config, state, {
      platform: 'facebook',
      externalAccountId: pageId,
      displayName: `Facebook · ${pageName}`,
      handle: pageUsername ? `@${pageUsername}` : undefined,
      token: pageToken,
      scopes,
    });
    facebookConnectionIds.push(facebookId);

    const instagram = page.instagram_business_account;
    const instagramId = typeof instagram?.id === 'string' ? instagram.id.trim() : '';
    if (!instagramId || seenInstagram.has(instagramId)) continue;
    seenInstagram.add(instagramId);
    const instagramUsername = typeof instagram?.username === 'string' ? instagram.username.trim() : '';
    const instagramName = typeof instagram?.name === 'string' ? instagram.name.trim() : '';
    const instagramLabel = instagramUsername || instagramName || pageName;
    const instagramConnectionId = await upsertAsset(db, config, state, {
      platform: 'instagram',
      externalAccountId: instagramId,
      displayName: `Instagram · ${instagramLabel}`,
      handle: instagramUsername ? `@${instagramUsername}` : undefined,
      token: pageToken,
      scopes,
    });
    instagramConnectionIds.push(instagramConnectionId);
  }

  if (!facebookConnectionIds.length && !instagramConnectionIds.length) {
    throw new MetaOAuthError('OAUTH_PROFILE_INVALID', 'No usable Meta business asset was returned.');
  }

  await auditMeta(db, state, 'oauth.meta_connected', {
    facebookAccounts: facebookConnectionIds.length,
    instagramAccounts: instagramConnectionIds.length,
    scopeCount: scopes.length,
  });

  return {
    workspaceId: state.workspace_id,
    facebookConnectionIds,
    instagramConnectionIds,
    connectedCount: facebookConnectionIds.length + instagramConnectionIds.length,
  };
}
