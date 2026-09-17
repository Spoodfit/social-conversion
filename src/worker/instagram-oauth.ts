import type { WorkspacePrincipal } from './authorization';
import { saveOAuthCredentials, loadOAuthTokens, tokenKeyringSecret } from './token-vault';

const instagramScopes = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
] as const;

interface OAuthStateRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  member_id: string;
  actor_subject: string;
  connection_id: string;
  redirect_uri: string;
  expires_at: string;
}

interface ShortTokenResponse {
  access_token?: unknown;
  user_id?: unknown;
}

interface LongTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface ProfileResponse {
  id?: unknown;
  user_id?: unknown;
  username?: unknown;
}

interface RefreshCandidateRow {
  workspace_id: string;
  connection_id: string;
  scopes_json: string;
  access_expires_at: string;
  last_refreshed_at: string | null;
  created_at: string;
}

export class InstagramOAuthError extends Error {
  readonly code:
    | 'OAUTH_NOT_CONFIGURED'
    | 'INVALID_OAUTH_STATE'
    | 'OAUTH_STATE_EXPIRED'
    | 'CONNECTION_NOT_FOUND'
    | 'OAUTH_PROVIDER_FAILED'
    | 'OAUTH_PROFILE_INVALID'
    | 'OAUTH_WEBHOOK_SUBSCRIPTION_FAILED';

  constructor(code: InstagramOAuthError['code'], message: string) {
    super(message);
    this.name = 'InstagramOAuthError';
    this.code = code;
  }
}

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function graphVersion(env: Env): string | undefined {
  const value = envString(env, 'META_GRAPH_VERSION');
  return value && /^v\d{1,3}\.\d{1,2}$/.test(value) ? value : undefined;
}

function oauthConfig(env: Env) {
  const appId = envString(env, 'INSTAGRAM_APP_ID');
  const appSecret = envString(env, 'INSTAGRAM_APP_SECRET');
  const redirectUri = envString(env, 'INSTAGRAM_REDIRECT_URI');
  const version = graphVersion(env);
  const keyring = tokenKeyringSecret(env);
  if (!appId || !appSecret || !redirectUri || !version || !keyring) return undefined;
  let parsedRedirect: URL;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    return undefined;
  }
  if (parsedRedirect.protocol !== 'https:' || parsedRedirect.username || parsedRedirect.password) return undefined;
  return { appId, appSecret, redirectUri, version, keyring };
}

export function instagramOAuthConfigured(env: Env): boolean {
  return Boolean(oauthConfig(env));
}

function safeConnectionId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value);
}

function expiresAtFromSeconds(seconds: unknown): string {
  const value = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value < 3_600 || value > 365 * 24 * 3_600) {
    throw new InstagramOAuthError('OAUTH_PROVIDER_FAILED', 'Instagram returned an invalid token lifetime.');
  }
  return new Date(Date.now() + value * 1_000).toISOString();
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  failureCode: InstagramOAuthError['code'],
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      console.warn(JSON.stringify({ event: 'instagram_oauth_provider_failed', status: response.status, step: failureCode }));
      throw new InstagramOAuthError(failureCode, `Instagram provider request failed with HTTP ${response.status}.`);
    }
    try {
      return await response.json();
    } catch {
      throw new InstagramOAuthError(failureCode, 'Instagram provider returned invalid JSON.');
    }
  } catch (error) {
    if (error instanceof InstagramOAuthError) throw error;
    throw new InstagramOAuthError(failureCode, 'Instagram provider request could not be completed.');
  } finally {
    clearTimeout(timeout);
  }
}

async function auditOAuth(
  db: D1Database,
  state: Pick<OAuthStateRow, 'workspace_id' | 'actor_subject' | 'connection_id'>,
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

export async function startInstagramOAuth(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
  requestedConnectionId?: string,
) {
  const config = oauthConfig(env);
  if (!config) throw new InstagramOAuthError('OAUTH_NOT_CONFIGURED', 'Instagram OAuth is not configured.');

  let connectionId = requestedConnectionId;
  if (connectionId !== undefined && !safeConnectionId(connectionId)) {
    throw new InstagramOAuthError('CONNECTION_NOT_FOUND', 'Instagram connection identifier is invalid.');
  }

  if (connectionId) {
    const existing = await db.prepare(
      `SELECT id FROM social_connections
       WHERE id = ? AND workspace_id = ? AND platform = 'instagram'`,
    ).bind(connectionId, principal.workspaceId).first<{ id: string }>();
    if (!existing) throw new InstagramOAuthError('CONNECTION_NOT_FOUND', 'Instagram connection not found in this workspace.');
  } else {
    connectionId = `ig:${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO social_connections
        (id, workspace_id, platform, display_name, status, capabilities_json, created_at, updated_at)
       VALUES (?, ?, 'instagram', 'Instagram — connexion en cours', 'pending', '{}', ?, ?)`,
    ).bind(connectionId, principal.workspaceId, now, now).run();
  }

  const state = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString();
  await db.prepare(
    `INSERT INTO oauth_states
      (id, workspace_id, member_id, actor_subject, provider, connection_id, redirect_uri, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'instagram', ?, ?, ?, ?)`,
  ).bind(
    state,
    principal.workspaceId,
    principal.memberId,
    principal.subject,
    connectionId,
    config.redirectUri,
    expiresAt,
    createdAt,
  ).run();

  const authorize = new URL('https://www.instagram.com/oauth/authorize');
  authorize.searchParams.set('client_id', config.appId);
  authorize.searchParams.set('redirect_uri', config.redirectUri);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', instagramScopes.join(','));
  authorize.searchParams.set('state', state);

  await auditOAuth(db, {
    workspace_id: principal.workspaceId,
    actor_subject: principal.subject,
    connection_id: connectionId,
  }, 'oauth.instagram_started', { expiresInSeconds: 600 });

  return { url: authorize.toString(), connectionId, expiresAt };
}

async function consumeOAuthState(db: D1Database, state: string): Promise<OAuthStateRow> {
  if (!/^[0-9a-f-]{36}$/i.test(state)) {
    throw new InstagramOAuthError('INVALID_OAUTH_STATE', 'Instagram OAuth state is invalid.');
  }
  const now = new Date().toISOString();
  const row = await db.prepare(
    `UPDATE oauth_states
     SET consumed_at = ?
     WHERE id = ? AND provider = 'instagram' AND consumed_at IS NULL AND expires_at > ?
     RETURNING id, workspace_id, member_id, actor_subject, connection_id, redirect_uri, expires_at,
       (SELECT name FROM workspaces WHERE id = oauth_states.workspace_id) AS workspace_name`,
  ).bind(now, state, now).first<OAuthStateRow>();
  if (row) return row;

  const existing = await db.prepare(
    `SELECT expires_at, consumed_at FROM oauth_states WHERE id = ? AND provider = 'instagram'`,
  ).bind(state).first<{ expires_at: string; consumed_at: string | null }>();
  if (existing && !existing.consumed_at && existing.expires_at <= now) {
    throw new InstagramOAuthError('OAUTH_STATE_EXPIRED', 'Instagram OAuth state has expired.');
  }
  throw new InstagramOAuthError('INVALID_OAUTH_STATE', 'Instagram OAuth state is invalid or already used.');
}

export async function completeInstagramOAuth(
  db: D1Database,
  env: Env,
  input: { state: string; code: string },
  fetchImpl: typeof fetch = fetch,
) {
  const config = oauthConfig(env);
  if (!config) throw new InstagramOAuthError('OAUTH_NOT_CONFIGURED', 'Instagram OAuth is not configured.');
  if (!input.code || input.code.length > 4_096) {
    throw new InstagramOAuthError('OAUTH_PROVIDER_FAILED', 'Instagram authorization code is invalid.');
  }

  const state = await consumeOAuthState(db, input.state);
  if (state.redirect_uri !== config.redirectUri) {
    throw new InstagramOAuthError('INVALID_OAUTH_STATE', 'Instagram OAuth redirect configuration changed during authorization.');
  }

  const shortBody = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
    code: input.code,
  });
  const shortPayload = await fetchJson(fetchImpl, 'https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: shortBody.toString(),
  }, 'OAUTH_PROVIDER_FAILED') as ShortTokenResponse;
  if (typeof shortPayload.access_token !== 'string' || !shortPayload.access_token) {
    throw new InstagramOAuthError('OAUTH_PROVIDER_FAILED', 'Instagram did not return a short-lived access token.');
  }

  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', config.appSecret);
  longUrl.searchParams.set('access_token', shortPayload.access_token);
  const longPayload = await fetchJson(fetchImpl, longUrl.toString(), { method: 'GET' }, 'OAUTH_PROVIDER_FAILED') as LongTokenResponse;
  if (typeof longPayload.access_token !== 'string' || !longPayload.access_token) {
    throw new InstagramOAuthError('OAUTH_PROVIDER_FAILED', 'Instagram did not return a long-lived access token.');
  }
  const accessExpiresAt = expiresAtFromSeconds(longPayload.expires_in);

  const profilePayload = await fetchJson(
    fetchImpl,
    `https://graph.instagram.com/${config.version}/me?fields=user_id,username`,
    { method: 'GET', headers: { authorization: `Bearer ${longPayload.access_token}` } },
    'OAUTH_PROFILE_INVALID',
  ) as ProfileResponse;
  const profileId = typeof profilePayload.user_id === 'string' || typeof profilePayload.user_id === 'number'
    ? String(profilePayload.user_id)
    : typeof profilePayload.id === 'string' || typeof profilePayload.id === 'number'
      ? String(profilePayload.id)
      : typeof shortPayload.user_id === 'string' || typeof shortPayload.user_id === 'number'
        ? String(shortPayload.user_id)
        : undefined;
  const username = typeof profilePayload.username === 'string' ? profilePayload.username.trim() : '';
  if (!profileId || !/^\d{3,40}$/.test(profileId) || !username || username.length > 100) {
    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram professional account profile could not be validated.');
  }
  if (shortPayload.user_id !== undefined && String(shortPayload.user_id) !== profileId) {
    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram token identity does not match the returned professional account.');
  }

  const subscriptionPayload = await fetchJson(
    fetchImpl,
    `https://graph.instagram.com/${config.version}/${encodeURIComponent(profileId)}/subscribed_apps`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${longPayload.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ subscribed_fields: ['messages', 'messaging_postbacks', 'comments'] }),
    },
    'OAUTH_WEBHOOK_SUBSCRIPTION_FAILED',
  ) as { success?: unknown };
  if (subscriptionPayload.success !== true) {
    throw new InstagramOAuthError('OAUTH_WEBHOOK_SUBSCRIPTION_FAILED', 'Instagram webhook subscription was not confirmed.');
  }

  const now = new Date().toISOString();
  try {
    await db.prepare(
      `UPDATE social_connections
       SET external_account_id = ?, display_name = ?, handle = ?, status = 'connected',
           capabilities_json = ?, last_synced_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND platform = 'instagram'`,
    ).bind(
      profileId,
      `Instagram · ${username}`,
      `@${username}`,
      JSON.stringify({ comments: true, direct_messages: true, private_reply: false, follow_trigger: false }),
      now,
      now,
      state.connection_id,
      state.workspace_id,
    ).run();
  } catch {
    throw new InstagramOAuthError('CONNECTION_NOT_FOUND', 'Instagram account is already connected elsewhere or the connection is unavailable.');
  }

  await saveOAuthCredentials(db, config.keyring, {
    workspaceId: state.workspace_id,
    connectionId: state.connection_id,
    provider: 'instagram',
    accessToken: longPayload.access_token,
    scopes: [...instagramScopes],
    accessExpiresAt,
  });

  await auditOAuth(db, state, 'oauth.instagram_connected', {
    accountId: profileId,
    scopeCount: instagramScopes.length,
    webhookSubscribed: true,
  });

  return {
    workspaceId: state.workspace_id,
    connectionId: state.connection_id,
    accountId: profileId,
    username,
    accessExpiresAt,
  };
}

export async function refreshExpiringInstagramTokens(
  db: D1Database,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshed: number; failed: number }> {
  const config = oauthConfig(env);
  if (!config) return { refreshed: 0, failed: 0 };
  const now = new Date();
  const threshold = new Date(now.getTime() + 7 * 24 * 3_600 * 1_000).toISOString();
  const oldEnough = new Date(now.getTime() - 24 * 3_600 * 1_000).toISOString();
  const result = await db.prepare(
    `SELECT workspace_id, connection_id, scopes_json, access_expires_at, last_refreshed_at, created_at
     FROM oauth_credentials
     WHERE provider = 'instagram' AND revoked_at IS NULL
       AND access_expires_at IS NOT NULL AND access_expires_at > ? AND access_expires_at <= ?
       AND COALESCE(last_refreshed_at, created_at) <= ?
     ORDER BY access_expires_at ASC
     LIMIT 10`,
  ).bind(now.toISOString(), threshold, oldEnough).all<RefreshCandidateRow>();

  let refreshed = 0;
  let failed = 0;
  for (const candidate of result.results) {
    try {
      const tokens = await loadOAuthTokens(db, config.keyring, candidate.workspace_id, candidate.connection_id);
      if (!tokens) continue;
      const refreshUrl = new URL('https://graph.instagram.com/refresh_access_token');
      refreshUrl.searchParams.set('grant_type', 'ig_refresh_token');
      refreshUrl.searchParams.set('access_token', tokens.accessToken);
      const payload = await fetchJson(fetchImpl, refreshUrl.toString(), { method: 'GET' }, 'OAUTH_PROVIDER_FAILED') as LongTokenResponse;
      if (typeof payload.access_token !== 'string' || !payload.access_token) {
        throw new InstagramOAuthError('OAUTH_PROVIDER_FAILED', 'Instagram refresh did not return an access token.');
      }
      let scopes: string[] = [];
      try {
        const parsed = JSON.parse(candidate.scopes_json) as unknown;
        if (Array.isArray(parsed)) scopes = parsed.filter((scope): scope is string => typeof scope === 'string');
      } catch {
        scopes = [];
      }
      await saveOAuthCredentials(db, config.keyring, {
        workspaceId: candidate.workspace_id,
        connectionId: candidate.connection_id,
        provider: 'instagram',
        accessToken: payload.access_token,
        scopes,
        accessExpiresAt: expiresAtFromSeconds(payload.expires_in),
      });
      refreshed += 1;
      console.log(JSON.stringify({
        event: 'instagram_oauth_refreshed',
        workspaceId: candidate.workspace_id,
        connectionId: candidate.connection_id,
      }));
    } catch (error) {
      failed += 1;
      console.warn(JSON.stringify({
        event: 'instagram_oauth_refresh_failed',
        workspaceId: candidate.workspace_id,
        connectionId: candidate.connection_id,
        code: error instanceof InstagramOAuthError ? error.code : 'unknown',
      }));
    }
  }
  return { refreshed, failed };
}
