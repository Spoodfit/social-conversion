import type { WorkspacePrincipal } from './authorization';
import { encryptToken, tokenKeyringSecret } from './token-vault';

const linkedinScopes = ['openid', 'profile', 'email', 'w_member_social'] as const;

type LinkedInConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  keyring: string;
};

type LinkedInStateRow = {
  id: string;
  workspace_id: string;
  member_id: string;
  actor_subject: string;
  connection_id: string;
  redirect_uri: string;
  expires_at: string;
};

type LinkedInTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
};

type LinkedInUserInfo = {
  sub?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  email?: unknown;
};

export class LinkedInOAuthError extends Error {
  readonly code:
    | 'OAUTH_NOT_CONFIGURED'
    | 'INVALID_OAUTH_STATE'
    | 'OAUTH_STATE_EXPIRED'
    | 'CONNECTION_NOT_FOUND'
    | 'OAUTH_PROVIDER_FAILED'
    | 'OAUTH_PROFILE_INVALID';

  constructor(code: LinkedInOAuthError['code'], message: string) {
    super(message);
    this.name = 'LinkedInOAuthError';
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

function configFor(env: Env): LinkedInConfig | undefined {
  const clientId = envString(env, 'LINKEDIN_CLIENT_ID');
  const clientSecret = envString(env, 'LINKEDIN_CLIENT_SECRET');
  const redirectUri = envString(env, 'LINKEDIN_REDIRECT_URI');
  const keyring = tokenKeyringSecret(env);
  if (!clientId || !clientSecret || !validHttpsUrl(redirectUri) || !keyring) return undefined;
  return { clientId, clientSecret, redirectUri, keyring };
}

export function linkedinOAuthConfigured(env: Env): boolean {
  return Boolean(configFor(env));
}

function safeConnectionId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value);
}

function expiresAtFromSeconds(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > 400 * 24 * 3_600) return undefined;
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function scopesFrom(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [...linkedinScopes];
  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))];
}

async function fetchJson(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      console.warn(JSON.stringify({
        event: 'linkedin_oauth_provider_failed',
        origin: new URL(url).origin,
        status: response.status,
      }));
      throw new LinkedInOAuthError('OAUTH_PROVIDER_FAILED', `LinkedIn provider request failed with HTTP ${response.status}.`);
    }
    try {
      return await response.json();
    } catch {
      throw new LinkedInOAuthError('OAUTH_PROVIDER_FAILED', 'LinkedIn returned invalid JSON.');
    }
  } catch (error) {
    if (error instanceof LinkedInOAuthError) throw error;
    throw new LinkedInOAuthError('OAUTH_PROVIDER_FAILED', 'LinkedIn provider request could not be completed.');
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
     VALUES (?, ?, ?, ?, 'linkedin_connection', ?, ?, ?)`,
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

export async function startLinkedInOAuth(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
  requestedConnectionId?: string,
) {
  const config = configFor(env);
  if (!config) throw new LinkedInOAuthError('OAUTH_NOT_CONFIGURED', 'LinkedIn OAuth is not configured.');

  let connectionId = requestedConnectionId;
  if (connectionId !== undefined && !safeConnectionId(connectionId)) {
    throw new LinkedInOAuthError('CONNECTION_NOT_FOUND', 'LinkedIn connection identifier is invalid.');
  }
  if (connectionId) {
    const existing = await db.prepare(
      `SELECT id FROM linkedin_connections WHERE id = ? AND workspace_id = ?`,
    ).bind(connectionId, principal.workspaceId).first<{ id: string }>();
    if (!existing) throw new LinkedInOAuthError('CONNECTION_NOT_FOUND', 'LinkedIn connection was not found in this workspace.');
  } else {
    connectionId = `li:${crypto.randomUUID()}`;
  }

  const state = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString();
  await db.prepare(
    `INSERT INTO linkedin_oauth_states
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

  const authorize = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('redirect_uri', config.redirectUri);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', linkedinScopes.join(' '));

  await auditOAuth(db, {
    workspaceId: principal.workspaceId,
    actorSubject: principal.subject,
    connectionId,
  }, 'oauth.linkedin_started', { expiresInSeconds: 600 });

  return { url: authorize.toString(), connectionId, expiresAt };
}

async function consumeState(db: D1Database, state: string): Promise<LinkedInStateRow> {
  if (!/^[0-9a-f-]{36}$/i.test(state)) {
    throw new LinkedInOAuthError('INVALID_OAUTH_STATE', 'LinkedIn OAuth state is invalid.');
  }
  const now = new Date().toISOString();
  const row = await db.prepare(
    `UPDATE linkedin_oauth_states
     SET consumed_at = ?
     WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
     RETURNING id, workspace_id, member_id, actor_subject, connection_id, redirect_uri, expires_at`,
  ).bind(now, state, now).first<LinkedInStateRow>();
  if (row) return row;

  const existing = await db.prepare(
    `SELECT expires_at, consumed_at FROM linkedin_oauth_states WHERE id = ?`,
  ).bind(state).first<{ expires_at: string; consumed_at: string | null }>();
  if (existing && !existing.consumed_at && existing.expires_at <= now) {
    throw new LinkedInOAuthError('OAUTH_STATE_EXPIRED', 'LinkedIn OAuth state has expired.');
  }
  throw new LinkedInOAuthError('INVALID_OAUTH_STATE', 'LinkedIn OAuth state is invalid or already used.');
}

export async function completeLinkedInOAuth(
  db: D1Database,
  env: Env,
  input: { state: string; code: string },
  fetchImpl: typeof fetch = fetch,
) {
  const config = configFor(env);
  if (!config) throw new LinkedInOAuthError('OAUTH_NOT_CONFIGURED', 'LinkedIn OAuth is not configured.');
  if (!input.code || input.code.length > 4_096) {
    throw new LinkedInOAuthError('OAUTH_PROVIDER_FAILED', 'LinkedIn authorization code is invalid.');
  }

  const state = await consumeState(db, input.state);
  if (state.redirect_uri !== config.redirectUri) {
    throw new LinkedInOAuthError('INVALID_OAUTH_STATE', 'LinkedIn OAuth redirect configuration changed during authorization.');
  }

  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
  const token = await fetchJson(fetchImpl, 'https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenForm.toString(),
  }) as LinkedInTokenResponse;

  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new LinkedInOAuthError('OAUTH_PROVIDER_FAILED', 'LinkedIn did not return an access token.');
  }

  const profile = await fetchJson(fetchImpl, 'https://api.linkedin.com/v2/userinfo', {
    method: 'GET',
    headers: { authorization: `Bearer ${token.access_token}` },
  }) as LinkedInUserInfo;

  const accountId = typeof profile.sub === 'string' ? profile.sub.trim() : '';
  const directName = typeof profile.name === 'string' ? profile.name.trim() : '';
  const firstName = typeof profile.given_name === 'string' ? profile.given_name.trim() : '';
  const lastName = typeof profile.family_name === 'string' ? profile.family_name.trim() : '';
  const email = typeof profile.email === 'string' ? profile.email.trim() : '';
  const displayName = directName || [firstName, lastName].filter(Boolean).join(' ') || email || 'Profil LinkedIn';
  if (!accountId || accountId.length > 255 || displayName.length > 255) {
    throw new LinkedInOAuthError('OAUTH_PROFILE_INVALID', 'LinkedIn profile could not be validated.');
  }

  const scopes = scopesFrom(token.scope);
  const existing = await db.prepare(
    `SELECT id FROM linkedin_connections WHERE workspace_id = ? AND external_account_id = ? LIMIT 1`,
  ).bind(state.workspace_id, accountId).first<{ id: string }>();
  const connectionId = existing?.id ?? state.connection_id;

  const access = await encryptToken(config.keyring, token.access_token, {
    workspaceId: state.workspace_id,
    connectionId,
    provider: 'linkedin',
    kind: 'access',
  });
  const refreshToken = typeof token.refresh_token === 'string' && token.refresh_token ? token.refresh_token : undefined;
  const refresh = refreshToken
    ? await encryptToken(config.keyring, refreshToken, {
      workspaceId: state.workspace_id,
      connectionId,
      provider: 'linkedin',
      kind: 'refresh',
    })
    : undefined;

  const now = new Date().toISOString();
  const accessExpiresAt = expiresAtFromSeconds(token.expires_in);
  const refreshExpiresAt = expiresAtFromSeconds(token.refresh_token_expires_in);
  const capabilities = {
    publishing: scopes.includes('w_member_social'),
    comments: false,
    direct_messages: false,
    organization_pages: false,
  };

  if (existing) {
    await db.prepare(
      `UPDATE linkedin_connections
       SET display_name = ?, handle = NULL, status = 'connected', capabilities_json = ?,
           access_token_ciphertext = ?, access_token_iv = ?, access_key_version = ?,
           refresh_token_ciphertext = ?, refresh_token_iv = ?, refresh_key_version = ?,
           scopes_json = ?, access_expires_at = ?, refresh_expires_at = ?, last_synced_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(
      `LinkedIn · ${displayName}`,
      JSON.stringify(capabilities),
      access.ciphertext,
      access.iv,
      access.keyVersion,
      refresh?.ciphertext ?? null,
      refresh?.iv ?? null,
      refresh?.keyVersion ?? null,
      JSON.stringify(scopes),
      accessExpiresAt ?? null,
      refreshExpiresAt ?? null,
      now,
      now,
      connectionId,
      state.workspace_id,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO linkedin_connections
        (id, workspace_id, external_account_id, display_name, handle, status, capabilities_json,
         access_token_ciphertext, access_token_iv, access_key_version,
         refresh_token_ciphertext, refresh_token_iv, refresh_key_version,
         scopes_json, access_expires_at, refresh_expires_at, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'connected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      connectionId,
      state.workspace_id,
      accountId,
      `LinkedIn · ${displayName}`,
      JSON.stringify(capabilities),
      access.ciphertext,
      access.iv,
      access.keyVersion,
      refresh?.ciphertext ?? null,
      refresh?.iv ?? null,
      refresh?.keyVersion ?? null,
      JSON.stringify(scopes),
      accessExpiresAt ?? null,
      refreshExpiresAt ?? null,
      now,
      now,
      now,
    ).run();
  }

  await auditOAuth(db, {
    workspaceId: state.workspace_id,
    actorSubject: state.actor_subject,
    connectionId,
  }, 'oauth.linkedin_connected', {
    accountId,
    publishing: capabilities.publishing,
    scopeCount: scopes.length,
  });

  return {
    workspaceId: state.workspace_id,
    connectionId,
    accountId,
    displayName,
    scopes,
    accessExpiresAt,
  };
}
