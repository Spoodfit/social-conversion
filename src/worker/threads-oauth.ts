import type { WorkspacePrincipal } from './authorization';
import { decryptToken, encryptToken, tokenKeyringSecret } from './token-vault';

const threadsScopes = [
  'threads_basic',
  'threads_content_publish',
  'threads_read_replies',
  'threads_manage_replies',
  'threads_manage_insights',
  'threads_manage_mentions',
] as const;

type ThreadsConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  keyring: string;
};

type ThreadsStateRow = {
  id: string;
  workspace_id: string;
  member_id: string;
  actor_subject: string;
  connection_id: string;
  redirect_uri: string;
  expires_at: string;
};

type ThreadsTokenResponse = {
  access_token?: unknown;
  user_id?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

type ThreadsProfile = {
  id?: unknown;
  username?: unknown;
  threads_profile_picture_url?: unknown;
};

type RefreshRow = {
  id: string;
  workspace_id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_key_version: string;
  scopes_json: string;
};

export class ThreadsOAuthError extends Error {
  readonly code:
    | 'OAUTH_NOT_CONFIGURED'
    | 'INVALID_OAUTH_STATE'
    | 'OAUTH_STATE_EXPIRED'
    | 'CONNECTION_NOT_FOUND'
    | 'OAUTH_PROVIDER_FAILED'
    | 'OAUTH_PROFILE_INVALID';

  constructor(code: ThreadsOAuthError['code'], message: string) {
    super(message);
    this.name = 'ThreadsOAuthError';
    this.code = code;
  }
}

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function configFor(env: Env): ThreadsConfig | undefined {
  const appId = envString(env, 'THREADS_APP_ID');
  const appSecret = envString(env, 'THREADS_APP_SECRET');
  const redirectUri = envString(env, 'THREADS_REDIRECT_URI');
  const keyring = tokenKeyringSecret(env);
  if (!appId || !appSecret || !validHttpsUrl(redirectUri) || !keyring) return undefined;
  return { appId, appSecret, redirectUri, keyring };
}

export function threadsOAuthConfigured(env: Env): boolean {
  return Boolean(configFor(env));
}

function safeConnectionId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value);
}

function expiresAtFromSeconds(value: unknown, fallbackSeconds = 60 * 24 * 3_600): string {
  const parsed = value === undefined || value === null ? fallbackSeconds : Number(value);
  const seconds = Number.isFinite(parsed) && parsed >= 60 && parsed <= 90 * 24 * 3_600
    ? parsed
    : fallbackSeconds;
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function scopesFrom(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [...threadsScopes];
  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))];
}

function parseStoredScopes(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [...threadsScopes];
  } catch {
    return [...threadsScopes];
  }
}

async function fetchJson(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      console.warn(JSON.stringify({
        event: 'threads_oauth_provider_failed',
        origin: new URL(url).origin,
        status: response.status,
      }));
      throw new ThreadsOAuthError('OAUTH_PROVIDER_FAILED', `Threads provider request failed with HTTP ${response.status}.`);
    }
    try {
      return await response.json();
    } catch {
      throw new ThreadsOAuthError('OAUTH_PROVIDER_FAILED', 'Threads returned invalid JSON.');
    }
  } catch (error) {
    if (error instanceof ThreadsOAuthError) throw error;
    throw new ThreadsOAuthError('OAUTH_PROVIDER_FAILED', 'Threads provider request could not be completed.');
  } finally {
    clearTimeout(timeout);
  }
}

async function auditOAuth(
  db: D1Database,
  input: { workspaceId: string; actorSubject: string; connectionId: string },
  action: string,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  await db.prepare(
    `INSERT INTO audit_logs
      (id, workspace_id, actor_id, action, resource_type, resource_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'threads_connection', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.workspaceId,
    input.actorSubject,
    action,
    input.connectionId,
    JSON.stringify(metadata),
    new Date().toISOString(),
  ).run();
}

export async function startThreadsOAuth(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
  requestedConnectionId?: string,
) {
  const config = configFor(env);
  if (!config) throw new ThreadsOAuthError('OAUTH_NOT_CONFIGURED', 'Threads OAuth is not configured.');

  let connectionId = requestedConnectionId;
  if (connectionId !== undefined && !safeConnectionId(connectionId)) {
    throw new ThreadsOAuthError('CONNECTION_NOT_FOUND', 'Threads connection identifier is invalid.');
  }
  if (connectionId) {
    const existing = await db.prepare(
      `SELECT id FROM threads_connections WHERE id = ? AND workspace_id = ?`,
    ).bind(connectionId, principal.workspaceId).first<{ id: string }>();
    if (!existing) throw new ThreadsOAuthError('CONNECTION_NOT_FOUND', 'Threads connection was not found in this workspace.');
  } else {
    connectionId = `th:${crypto.randomUUID()}`;
  }

  const state = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString();
  await db.prepare(
    `INSERT INTO threads_oauth_states
      (id, workspace_id, member_id, actor_subject, connection_id, redirect_uri, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    state,
    principal.workspaceId,
    principal.memberId,
    principal.subject,
    connectionId,
    config.redirectUri,
    expiresAt,
    now,
  ).run();

  const authorize = new URL('https://threads.net/oauth/authorize');
  authorize.searchParams.set('client_id', config.appId);
  authorize.searchParams.set('redirect_uri', config.redirectUri);
  authorize.searchParams.set('scope', threadsScopes.join(','));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('state', state);

  await auditOAuth(db, {
    workspaceId: principal.workspaceId,
    actorSubject: principal.subject,
    connectionId,
  }, 'oauth.threads_started', { expiresInSeconds: 600, scopeCount: threadsScopes.length });

  return { url: authorize.toString(), connectionId, expiresAt };
}

async function consumeState(db: D1Database, state: string): Promise<ThreadsStateRow> {
  if (!/^[0-9a-f-]{36}$/i.test(state)) {
    throw new ThreadsOAuthError('INVALID_OAUTH_STATE', 'Threads OAuth state is invalid.');
  }
  const now = new Date().toISOString();
  const row = await db.prepare(
    `UPDATE threads_oauth_states
     SET consumed_at = ?
     WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
     RETURNING id, workspace_id, member_id, actor_subject, connection_id, redirect_uri, expires_at`,
  ).bind(now, state, now).first<ThreadsStateRow>();
  if (row) return row;

  const existing = await db.prepare(
    `SELECT expires_at, consumed_at FROM threads_oauth_states WHERE id = ?`,
  ).bind(state).first<{ expires_at: string; consumed_at: string | null }>();
  if (existing && !existing.consumed_at && existing.expires_at <= now) {
    throw new ThreadsOAuthError('OAUTH_STATE_EXPIRED', 'Threads OAuth state has expired.');
  }
  throw new ThreadsOAuthError('INVALID_OAUTH_STATE', 'Threads OAuth state is invalid or already used.');
}

export async function completeThreadsOAuth(
  db: D1Database,
  env: Env,
  input: { state: string; code: string },
  fetchImpl: typeof fetch = fetch,
) {
  const config = configFor(env);
  if (!config) throw new ThreadsOAuthError('OAUTH_NOT_CONFIGURED', 'Threads OAuth is not configured.');
  if (!input.code || input.code.length > 4_096) {
    throw new ThreadsOAuthError('OAUTH_PROVIDER_FAILED', 'Threads authorization code is invalid.');
  }

  const state = await consumeState(db, input.state);
  if (state.redirect_uri !== config.redirectUri) {
    throw new ThreadsOAuthError('INVALID_OAUTH_STATE', 'Threads OAuth redirect configuration changed during authorization.');
  }

  const form = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code: input.code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  const shortToken = await fetchJson(fetchImpl, 'https://graph.threads.net/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as ThreadsTokenResponse;
  if (typeof shortToken.access_token !== 'string' || !shortToken.access_token) {
    throw new ThreadsOAuthError('OAUTH_PROVIDER_FAILED', 'Threads did not return an access token.');
  }

  const exchange = new URL('https://graph.threads.net/access_token');
  exchange.searchParams.set('grant_type', 'th_exchange_token');
  exchange.searchParams.set('client_secret', config.appSecret);
  exchange.searchParams.set('access_token', shortToken.access_token);
  const longToken = await fetchJson(fetchImpl, exchange.toString(), { method: 'GET' }) as ThreadsTokenResponse;
  const accessToken = typeof longToken.access_token === 'string' && longToken.access_token
    ? longToken.access_token
    : shortToken.access_token;

  const profileUrl = new URL('https://graph.threads.net/v1.0/me');
  profileUrl.searchParams.set('fields', 'id,username,threads_profile_picture_url');
  profileUrl.searchParams.set('access_token', accessToken);
  const profile = await fetchJson(fetchImpl, profileUrl.toString(), { method: 'GET' }) as ThreadsProfile;

  const fallbackUserId = typeof shortToken.user_id === 'string' || typeof shortToken.user_id === 'number'
    ? String(shortToken.user_id).trim()
    : '';
  const accountId = typeof profile.id === 'string' || typeof profile.id === 'number'
    ? String(profile.id).trim()
    : fallbackUserId;
  const username = typeof profile.username === 'string' ? profile.username.trim().replace(/^@+/, '') : '';
  if (!accountId || accountId.length > 255 || !username || username.length > 255) {
    throw new ThreadsOAuthError('OAUTH_PROFILE_INVALID', 'Threads profile could not be validated.');
  }

  const scopes = scopesFrom(shortToken.scope);
  const existing = await db.prepare(
    `SELECT id FROM threads_connections WHERE workspace_id = ? AND external_account_id = ? LIMIT 1`,
  ).bind(state.workspace_id, accountId).first<{ id: string }>();
  const connectionId = existing?.id ?? state.connection_id;

  const access = await encryptToken(config.keyring, accessToken, {
    workspaceId: state.workspace_id,
    connectionId,
    provider: 'threads',
    kind: 'access',
  });
  const now = new Date().toISOString();
  const accessExpiresAt = expiresAtFromSeconds(longToken.expires_in);
  const capabilities = {
    publishing: scopes.includes('threads_content_publish'),
    comments: scopes.includes('threads_read_replies') || scopes.includes('threads_manage_replies'),
    replies: scopes.includes('threads_manage_replies'),
    insights: scopes.includes('threads_manage_insights'),
    mentions: scopes.includes('threads_manage_mentions'),
    direct_messages: false,
  };

  if (existing) {
    await db.prepare(
      `UPDATE threads_connections
       SET display_name = ?, handle = ?, status = 'connected', capabilities_json = ?,
           access_token_ciphertext = ?, access_token_iv = ?, access_key_version = ?,
           scopes_json = ?, access_expires_at = ?, last_refreshed_at = ?, last_synced_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(
      `Threads · @${username}`,
      `@${username}`,
      JSON.stringify(capabilities),
      access.ciphertext,
      access.iv,
      access.keyVersion,
      JSON.stringify(scopes),
      accessExpiresAt,
      now,
      now,
      now,
      connectionId,
      state.workspace_id,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO threads_connections
        (id, workspace_id, external_account_id, display_name, handle, status, capabilities_json,
         access_token_ciphertext, access_token_iv, access_key_version, scopes_json,
         access_expires_at, last_refreshed_at, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      connectionId,
      state.workspace_id,
      accountId,
      `Threads · @${username}`,
      `@${username}`,
      JSON.stringify(capabilities),
      access.ciphertext,
      access.iv,
      access.keyVersion,
      JSON.stringify(scopes),
      accessExpiresAt,
      now,
      now,
      now,
      now,
    ).run();
  }

  await auditOAuth(db, {
    workspaceId: state.workspace_id,
    actorSubject: state.actor_subject,
    connectionId,
  }, 'oauth.threads_connected', {
    accountId,
    publishing: capabilities.publishing,
    replies: capabilities.replies,
    insights: capabilities.insights,
  });

  return {
    workspaceId: state.workspace_id,
    connectionId,
    accountId,
    displayName: username,
    handle: `@${username}`,
    scopes,
    accessExpiresAt,
  };
}

export async function refreshExpiringThreadsTokens(
  db: D1Database,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshed: number; failed: number }> {
  const config = configFor(env);
  if (!config) return { refreshed: 0, failed: 0 };

  const now = new Date();
  const refreshBefore = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  const oldEnough = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const result = await db.prepare(
    `SELECT id, workspace_id, access_token_ciphertext, access_token_iv, access_key_version, scopes_json
     FROM threads_connections
     WHERE status = 'connected'
       AND access_expires_at IS NOT NULL
       AND access_expires_at > ?
       AND access_expires_at <= ?
       AND COALESCE(last_refreshed_at, created_at) <= ?
     ORDER BY access_expires_at ASC
     LIMIT 20`,
  ).bind(now.toISOString(), refreshBefore, oldEnough).all<RefreshRow>();

  let refreshed = 0;
  let failed = 0;
  for (const row of result.results) {
    try {
      const currentToken = await decryptToken(config.keyring, {
        ciphertext: row.access_token_ciphertext,
        iv: row.access_token_iv,
        keyVersion: row.access_key_version,
      }, {
        workspaceId: row.workspace_id,
        connectionId: row.id,
        provider: 'threads',
        kind: 'access',
      });

      const refreshUrl = new URL('https://graph.threads.net/refresh_access_token');
      refreshUrl.searchParams.set('grant_type', 'th_refresh_token');
      refreshUrl.searchParams.set('access_token', currentToken);
      const payload = await fetchJson(fetchImpl, refreshUrl.toString(), { method: 'GET' }) as ThreadsTokenResponse;
      if (typeof payload.access_token !== 'string' || !payload.access_token) {
        throw new ThreadsOAuthError('OAUTH_PROVIDER_FAILED', 'Threads token refresh did not return an access token.');
      }

      const encrypted = await encryptToken(config.keyring, payload.access_token, {
        workspaceId: row.workspace_id,
        connectionId: row.id,
        provider: 'threads',
        kind: 'access',
      });
      const refreshedAt = new Date().toISOString();
      await db.prepare(
        `UPDATE threads_connections
         SET access_token_ciphertext = ?, access_token_iv = ?, access_key_version = ?,
             access_expires_at = ?, last_refreshed_at = ?, updated_at = ?, scopes_json = ?
         WHERE id = ? AND workspace_id = ?`,
      ).bind(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.keyVersion,
        expiresAtFromSeconds(payload.expires_in),
        refreshedAt,
        refreshedAt,
        JSON.stringify(parseStoredScopes(row.scopes_json)),
        row.id,
        row.workspace_id,
      ).run();
      refreshed += 1;
    } catch (error) {
      failed += 1;
      console.warn(JSON.stringify({
        event: 'threads_oauth_refresh_failed',
        connectionId: row.id,
        message: error instanceof Error ? error.message : 'unknown',
      }));
    }
  }

  return { refreshed, failed };
}
