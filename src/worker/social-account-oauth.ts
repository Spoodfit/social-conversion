import type { WorkspacePrincipal } from './authorization';
import { loadOAuthTokens, saveOAuthCredentials, tokenKeyringSecret, type OAuthProvider } from './token-vault';

export type SocialOAuthProvider = Exclude<OAuthProvider, 'instagram'>;

const youtubeScopes = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
] as const;
const tiktokScopes = ['user.info.basic'] as const;

type OAuthConfig = {
  provider: SocialOAuthProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  keyring: string;
};

type OAuthStateRow = {
  id: string;
  workspace_id: string;
  member_id: string;
  actor_subject: string;
  connection_id: string;
  redirect_uri: string;
  expires_at: string;
};

type RefreshCandidateRow = {
  workspace_id: string;
  connection_id: string;
  provider: SocialOAuthProvider;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
  last_refreshed_at: string | null;
  created_at: string;
};

export class SocialOAuthError extends Error {
  readonly code:
    | 'OAUTH_NOT_CONFIGURED'
    | 'INVALID_OAUTH_STATE'
    | 'OAUTH_STATE_EXPIRED'
    | 'CONNECTION_NOT_FOUND'
    | 'CONNECTION_ALREADY_CONNECTED'
    | 'OAUTH_PROVIDER_FAILED'
    | 'OAUTH_PROFILE_INVALID';

  constructor(code: SocialOAuthError['code'], message: string) {
    super(message);
    this.name = 'SocialOAuthError';
    this.code = code;
  }
}

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validRedirect(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function configFor(env: Env, provider: SocialOAuthProvider): OAuthConfig | undefined {
  const keyring = tokenKeyringSecret(env);
  const redirectUri = envString(env, provider === 'youtube' ? 'YOUTUBE_REDIRECT_URI' : 'TIKTOK_REDIRECT_URI');
  const clientId = envString(env, provider === 'youtube' ? 'YOUTUBE_CLIENT_ID' : 'TIKTOK_CLIENT_KEY');
  const clientSecret = envString(env, provider === 'youtube' ? 'YOUTUBE_CLIENT_SECRET' : 'TIKTOK_CLIENT_SECRET');
  if (!keyring || !clientId || !clientSecret || !validRedirect(redirectUri)) return undefined;
  return { provider, keyring, redirectUri, clientId, clientSecret };
}

export function socialOAuthConfigured(env: Env, provider: SocialOAuthProvider): boolean {
  return Boolean(configFor(env, provider));
}

function safeConnectionId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value);
}

function expiryFromSeconds(seconds: unknown, fallbackSeconds?: number): string | undefined {
  const raw = seconds === undefined || seconds === null ? fallbackSeconds : Number(seconds);
  if (raw === undefined || !Number.isFinite(raw) || raw < 60 || raw > 400 * 24 * 3_600) return undefined;
  return new Date(Date.now() + raw * 1_000).toISOString();
}

async function fetchJson(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      console.warn(JSON.stringify({ event: 'social_oauth_provider_failed', url: new URL(url).origin, status: response.status }));
      throw new SocialOAuthError('OAUTH_PROVIDER_FAILED', `OAuth provider request failed with HTTP ${response.status}.`);
    }
    try {
      return await response.json();
    } catch {
      throw new SocialOAuthError('OAUTH_PROVIDER_FAILED', 'OAuth provider returned invalid JSON.');
    }
  } catch (error) {
    if (error instanceof SocialOAuthError) throw error;
    throw new SocialOAuthError('OAUTH_PROVIDER_FAILED', 'OAuth provider request could not be completed.');
  } finally {
    clearTimeout(timeout);
  }
}

async function auditOAuth(
  db: D1Database,
  state: Pick<OAuthStateRow, 'workspace_id' | 'actor_subject' | 'connection_id'>,
  provider: SocialOAuthProvider,
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
    JSON.stringify({ provider, ...metadata }),
    new Date().toISOString(),
  ).run();
}

async function ensurePendingConnection(
  db: D1Database,
  principal: WorkspacePrincipal,
  provider: SocialOAuthProvider,
  requestedConnectionId?: string,
): Promise<string> {
  if (requestedConnectionId !== undefined && !safeConnectionId(requestedConnectionId)) {
    throw new SocialOAuthError('CONNECTION_NOT_FOUND', 'Social connection identifier is invalid.');
  }
  if (requestedConnectionId) {
    const existing = await db.prepare(
      `SELECT id FROM social_connections WHERE id = ? AND workspace_id = ? AND platform = ?`,
    ).bind(requestedConnectionId, principal.workspaceId, provider).first<{ id: string }>();
    if (!existing) throw new SocialOAuthError('CONNECTION_NOT_FOUND', 'Social connection was not found in this workspace.');
    return requestedConnectionId;
  }

  const prefix = provider === 'youtube' ? 'yt' : 'tk';
  const id = `${prefix}:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO social_connections
      (id, workspace_id, platform, display_name, status, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', '{}', ?, ?)`,
  ).bind(id, principal.workspaceId, provider, `${provider === 'youtube' ? 'YouTube' : 'TikTok'} — connexion en cours`, now, now).run();
  return id;
}

export async function startSocialOAuth(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
  provider: SocialOAuthProvider,
  requestedConnectionId?: string,
) {
  const config = configFor(env, provider);
  if (!config) throw new SocialOAuthError('OAUTH_NOT_CONFIGURED', `${provider === 'youtube' ? 'YouTube' : 'TikTok'} OAuth is not configured.`);
  const connectionId = await ensurePendingConnection(db, principal, provider, requestedConnectionId);
  const state = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString();

  await db.prepare(
    `INSERT INTO oauth_states
      (id, workspace_id, member_id, actor_subject, provider, connection_id, redirect_uri, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(state, principal.workspaceId, principal.memberId, principal.subject, provider, connectionId, config.redirectUri, expiresAt, now).run();

  let authorize: URL;
  if (provider === 'youtube') {
    authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorize.searchParams.set('client_id', config.clientId);
    authorize.searchParams.set('redirect_uri', config.redirectUri);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', youtubeScopes.join(' '));
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('access_type', 'offline');
    authorize.searchParams.set('include_granted_scopes', 'true');
    authorize.searchParams.set('prompt', 'consent');
  } else {
    authorize = new URL('https://www.tiktok.com/v2/auth/authorize/');
    authorize.searchParams.set('client_key', config.clientId);
    authorize.searchParams.set('redirect_uri', config.redirectUri);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', tiktokScopes.join(','));
    authorize.searchParams.set('state', state);
  }

  await auditOAuth(db, {
    workspace_id: principal.workspaceId,
    actor_subject: principal.subject,
    connection_id: connectionId,
  }, provider, `oauth.${provider}_started`, { expiresInSeconds: 600 });

  return { url: authorize.toString(), connectionId, expiresAt };
}

async function consumeState(db: D1Database, provider: SocialOAuthProvider, state: string): Promise<OAuthStateRow> {
  if (!/^[0-9a-f-]{36}$/i.test(state)) throw new SocialOAuthError('INVALID_OAUTH_STATE', 'OAuth state is invalid.');
  const now = new Date().toISOString();
  const row = await db.prepare(
    `UPDATE oauth_states SET consumed_at = ?
     WHERE id = ? AND provider = ? AND consumed_at IS NULL AND expires_at > ?
     RETURNING id, workspace_id, member_id, actor_subject, connection_id, redirect_uri, expires_at`,
  ).bind(now, state, provider, now).first<OAuthStateRow>();
  if (row) return row;
  const existing = await db.prepare(
    `SELECT expires_at, consumed_at FROM oauth_states WHERE id = ? AND provider = ?`,
  ).bind(state, provider).first<{ expires_at: string; consumed_at: string | null }>();
  if (existing && !existing.consumed_at && existing.expires_at <= now) {
    throw new SocialOAuthError('OAUTH_STATE_EXPIRED', 'OAuth state has expired.');
  }
  throw new SocialOAuthError('INVALID_OAUTH_STATE', 'OAuth state is invalid or already used.');
}

function scopesFrom(value: unknown, fallback: readonly string[], delimiter: RegExp): string[] {
  if (typeof value !== 'string' || !value.trim()) return [...fallback];
  return [...new Set(value.split(delimiter).map((scope) => scope.trim()).filter(Boolean))];
}

async function ensureUniqueAccount(
  db: D1Database,
  state: OAuthStateRow,
  provider: SocialOAuthProvider,
  externalAccountId: string,
) {
  const duplicate = await db.prepare(
    `SELECT id FROM social_connections
     WHERE workspace_id = ? AND platform = ? AND external_account_id = ? AND id <> ? AND status = 'connected'
     LIMIT 1`,
  ).bind(state.workspace_id, provider, externalAccountId, state.connection_id).first<{ id: string }>();
  if (duplicate) throw new SocialOAuthError('CONNECTION_ALREADY_CONNECTED', 'This social account is already connected to this workspace.');
}

async function completeYoutube(
  db: D1Database,
  config: OAuthConfig,
  state: OAuthStateRow,
  code: string,
  fetchImpl: typeof fetch,
) {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  const token = await fetchJson(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
  if (typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' || !token.refresh_token) {
    throw new SocialOAuthError('OAUTH_PROVIDER_FAILED', 'Google did not return durable OAuth credentials.');
  }
  const profile = await fetchJson(fetchImpl, 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    method: 'GET',
    headers: { authorization: `Bearer ${token.access_token}` },
  }) as { items?: Array<{ id?: unknown; snippet?: { title?: unknown; customUrl?: unknown } }> };
  const channel = Array.isArray(profile.items) ? profile.items[0] : undefined;
  const accountId = typeof channel?.id === 'string' ? channel.id.trim() : '';
  const title = typeof channel?.snippet?.title === 'string' ? channel.snippet.title.trim() : '';
  const customUrl = typeof channel?.snippet?.customUrl === 'string' ? channel.snippet.customUrl.trim() : '';
  if (!accountId || !title) throw new SocialOAuthError('OAUTH_PROFILE_INVALID', 'YouTube channel could not be validated.');
  await ensureUniqueAccount(db, state, 'youtube', accountId);
  const scopes = scopesFrom(token.scope, youtubeScopes, /\s+/);
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE social_connections
     SET external_account_id = ?, display_name = ?, handle = ?, status = 'connected', capabilities_json = ?, last_synced_at = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND platform = 'youtube'`,
  ).bind(
    accountId,
    `YouTube · ${title}`,
    customUrl || null,
    JSON.stringify({ comments: scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl'), direct_messages: false, publishing: scopes.includes('https://www.googleapis.com/auth/youtube.upload') }),
    now,
    now,
    state.connection_id,
    state.workspace_id,
  ).run();
  const accessExpiresAt = expiryFromSeconds(token.expires_in, 3_600);
  await saveOAuthCredentials(db, config.keyring, {
    workspaceId: state.workspace_id,
    connectionId: state.connection_id,
    provider: 'youtube',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scopes,
    accessExpiresAt,
  });
  return { accountId, displayName: title, handle: customUrl || undefined, accessExpiresAt };
}

async function completeTikTok(
  db: D1Database,
  config: OAuthConfig,
  state: OAuthStateRow,
  code: string,
  fetchImpl: typeof fetch,
) {
  const form = new URLSearchParams({
    client_key: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  const token = await fetchJson(fetchImpl, 'https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    refresh_expires_in?: unknown;
    open_id?: unknown;
    scope?: unknown;
  };
  if (typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' || !token.refresh_token) {
    throw new SocialOAuthError('OAUTH_PROVIDER_FAILED', 'TikTok did not return durable OAuth credentials.');
  }
  const profile = await fetchJson(fetchImpl, 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
    method: 'GET',
    headers: { authorization: `Bearer ${token.access_token}` },
  }) as { data?: { user?: { open_id?: unknown; display_name?: unknown } } };
  const accountId = typeof profile.data?.user?.open_id === 'string'
    ? profile.data.user.open_id.trim()
    : typeof token.open_id === 'string'
      ? token.open_id.trim()
      : '';
  const displayName = typeof profile.data?.user?.display_name === 'string' ? profile.data.user.display_name.trim() : '';
  if (!accountId || !displayName) throw new SocialOAuthError('OAUTH_PROFILE_INVALID', 'TikTok profile could not be validated.');
  await ensureUniqueAccount(db, state, 'tiktok', accountId);
  const scopes = scopesFrom(token.scope, tiktokScopes, /[\s,]+/);
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE social_connections
     SET external_account_id = ?, display_name = ?, handle = NULL, status = 'connected', capabilities_json = ?, last_synced_at = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND platform = 'tiktok'`,
  ).bind(
    accountId,
    `TikTok · ${displayName}`,
    JSON.stringify({ comments: false, direct_messages: false, publishing: scopes.includes('video.publish'), upload: scopes.includes('video.upload') }),
    now,
    now,
    state.connection_id,
    state.workspace_id,
  ).run();
  const accessExpiresAt = expiryFromSeconds(token.expires_in, 86_400);
  const refreshExpiresAt = expiryFromSeconds(token.refresh_expires_in, 365 * 24 * 3_600);
  await saveOAuthCredentials(db, config.keyring, {
    workspaceId: state.workspace_id,
    connectionId: state.connection_id,
    provider: 'tiktok',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scopes,
    accessExpiresAt,
    refreshExpiresAt,
  });
  return { accountId, displayName, accessExpiresAt, refreshExpiresAt };
}

export async function completeSocialOAuth(
  db: D1Database,
  env: Env,
  provider: SocialOAuthProvider,
  input: { state: string; code: string },
  fetchImpl: typeof fetch = fetch,
) {
  const config = configFor(env, provider);
  if (!config) throw new SocialOAuthError('OAUTH_NOT_CONFIGURED', `${provider === 'youtube' ? 'YouTube' : 'TikTok'} OAuth is not configured.`);
  if (!input.code || input.code.length > 4_096) throw new SocialOAuthError('OAUTH_PROVIDER_FAILED', 'OAuth authorization code is invalid.');
  const state = await consumeState(db, provider, input.state);
  if (state.redirect_uri !== config.redirectUri) throw new SocialOAuthError('INVALID_OAUTH_STATE', 'OAuth redirect configuration changed during authorization.');
  const completed = provider === 'youtube'
    ? await completeYoutube(db, config, state, input.code, fetchImpl)
    : await completeTikTok(db, config, state, input.code, fetchImpl);
  await auditOAuth(db, state, provider, `oauth.${provider}_connected`, { accountId: completed.accountId });
  return { workspaceId: state.workspace_id, connectionId: state.connection_id, provider, ...completed };
}

async function refreshCandidate(
  db: D1Database,
  env: Env,
  candidate: RefreshCandidateRow,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const config = configFor(env, candidate.provider);
  if (!config) return false;
  const tokens = await loadOAuthTokens(db, config.keyring, candidate.workspace_id, candidate.connection_id);
  if (!tokens?.refreshToken) return false;
  if (candidate.refresh_expires_at && candidate.refresh_expires_at <= new Date().toISOString()) return false;

  let payload: {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    refresh_expires_in?: unknown;
    scope?: unknown;
  };
  if (candidate.provider === 'youtube') {
    const form = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    });
    payload = await fetchJson(fetchImpl, 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }) as typeof payload;
  } else {
    const form = new URLSearchParams({
      client_key: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
    payload = await fetchJson(fetchImpl, 'https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }) as typeof payload;
  }
  if (typeof payload.access_token !== 'string' || !payload.access_token) return false;
  const scopes = scopesFrom(payload.scope, tokens.credentials.scopes, /[\s,]+/);
  await saveOAuthCredentials(db, config.keyring, {
    workspaceId: candidate.workspace_id,
    connectionId: candidate.connection_id,
    provider: candidate.provider,
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token ? payload.refresh_token : undefined,
    scopes,
    accessExpiresAt: expiryFromSeconds(payload.expires_in, candidate.provider === 'youtube' ? 3_600 : 86_400),
    refreshExpiresAt: candidate.provider === 'tiktok' ? expiryFromSeconds(payload.refresh_expires_in) : undefined,
  });
  return true;
}

export async function refreshExpiringSocialTokens(
  db: D1Database,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshed: number; failed: number }> {
  const now = new Date();
  const threshold = new Date(now.getTime() + 30 * 60 * 1_000).toISOString();
  const oldEnough = new Date(now.getTime() - 5 * 60 * 1_000).toISOString();
  const result = await db.prepare(
    `SELECT workspace_id, connection_id, provider, access_expires_at, refresh_expires_at, last_refreshed_at, created_at
     FROM oauth_credentials
     WHERE provider IN ('youtube', 'tiktok') AND revoked_at IS NULL
       AND access_expires_at IS NOT NULL AND access_expires_at > ? AND access_expires_at <= ?
       AND COALESCE(last_refreshed_at, created_at) <= ?
     ORDER BY access_expires_at ASC LIMIT 20`,
  ).bind(now.toISOString(), threshold, oldEnough).all<RefreshCandidateRow>();
  let refreshed = 0;
  let failed = 0;
  for (const candidate of result.results) {
    try {
      if (await refreshCandidate(db, env, candidate, fetchImpl)) refreshed += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.warn(JSON.stringify({ event: 'social_oauth_refresh_failed', provider: candidate.provider, connectionId: candidate.connection_id, message: error instanceof Error ? error.message : 'unknown' }));
    }
  }
  return { refreshed, failed };
}
