import type { WorkspacePrincipal } from './authorization';
import { decryptToken, encryptToken, tokenKeyringSecret } from './token-vault';

const communityScopes = [
  'openid',
  'profile',
  'email',
  'r_organization_admin',
  'r_organization_social',
  'w_organization_social',
  'r_organization_social_feed',
  'w_organization_social_feed',
] as const;

const LINKEDIN_VERSION = '202608';
const SYNC_THROTTLE_MS = 15 * 60_000;
const MAX_POSTS = 50;
const MAX_COMMENT_POSTS = 30;

type CommunityConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  keyring: string;
};

type CommunityState = {
  id: string;
  workspace_id: string;
  member_id: string;
  actor_subject: string;
  redirect_uri: string;
  expires_at: string;
};

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
};

type UserInfo = { sub?: unknown; name?: unknown };

type OrganizationAcl = {
  role?: unknown;
  organization?: unknown;
  organizationTarget?: unknown;
  roleAssignee?: unknown;
  state?: unknown;
};

type OrganizationDetail = {
  id?: unknown;
  localizedName?: unknown;
  vanityName?: unknown;
};

type OrganizationConnection = {
  id: string;
  workspace_id: string;
  external_account_id: string;
  organization_urn: string;
  display_name: string;
  handle: string | null;
  scopes_json: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_key_version: string;
};

type LinkedInPost = {
  id?: unknown;
  commentary?: unknown;
  createdAt?: unknown;
  publishedAt?: unknown;
  lastModifiedAt?: unknown;
  content?: unknown;
};

type LinkedInComment = {
  id?: unknown;
  actor?: unknown;
  commentUrn?: unknown;
  created?: { time?: unknown };
  message?: { text?: unknown };
  object?: unknown;
  parentComment?: unknown;
};

type RestCollection<T> = {
  elements?: T[];
  paging?: { links?: Array<{ rel?: unknown; href?: unknown }> };
};

export class LinkedInCommunityError extends Error {
  readonly code:
    | 'OAUTH_NOT_CONFIGURED'
    | 'INVALID_OAUTH_STATE'
    | 'OAUTH_STATE_EXPIRED'
    | 'COMMUNITY_ACCESS_REQUIRED'
    | 'NO_ORGANIZATIONS'
    | 'OAUTH_PROVIDER_FAILED';

  constructor(code: LinkedInCommunityError['code'], message: string) {
    super(message);
    this.name = 'LinkedInCommunityError';
    this.code = code;
  }
}

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function configFor(env: Env): CommunityConfig | undefined {
  const clientId = envString(env, 'LINKEDIN_CLIENT_ID');
  const clientSecret = envString(env, 'LINKEDIN_CLIENT_SECRET');
  const redirectUri = envString(env, 'LINKEDIN_REDIRECT_URI');
  const keyring = tokenKeyringSecret(env);
  if (!clientId || !clientSecret || !redirectUri || !keyring) return undefined;
  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }
  return { clientId, clientSecret, redirectUri, keyring };
}

export function linkedinCommunityConfigured(env: Env): boolean {
  return Boolean(configFor(env));
}

function str(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function millisToIso(value: unknown): string | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  const date = new Date(number);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function expiry(value: unknown): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > 400 * 24 * 3600) return undefined;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function scopesFrom(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [...communityScopes];
  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))];
}

function restHeaders(token: string, extra: HeadersInit = {}): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

async function providerJson<T>(fetchImpl: typeof fetch, url: string, token: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: restHeaders(token, init.headers),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      const detail = text.slice(0, 700);
      if (response.status === 401 || response.status === 403) {
        throw new LinkedInCommunityError(
          'COMMUNITY_ACCESS_REQUIRED',
          `LinkedIn Community Management a refusé la requête (${response.status})${detail ? ` : ${detail}` : ''}`.slice(0, 1000),
        );
      }
      throw new LinkedInCommunityError(
        'OAUTH_PROVIDER_FAILED',
        `LinkedIn a refusé la requête (${response.status})${detail ? ` : ${detail}` : ''}`.slice(0, 1000),
      );
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', 'LinkedIn a retourné une réponse invalide.');
    }
  } catch (error) {
    if (error instanceof LinkedInCommunityError) throw error;
    throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', 'La requête LinkedIn n’a pas pu aboutir.');
  } finally {
    clearTimeout(timeout);
  }
}

async function tokenExchange(fetchImpl: typeof fetch, config: CommunityConfig, code: string): Promise<TokenResponse> {
  const response = await fetchImpl('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }).toString(),
  });
  const body = await response.text().catch(() => '');
  if (!response.ok) {
    throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', `Échange du jeton LinkedIn refusé (${response.status}).`);
  }
  try {
    return JSON.parse(body) as TokenResponse;
  } catch {
    throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', 'LinkedIn a retourné un jeton invalide.');
  }
}

export async function isLinkedInCommunityState(db: D1Database, state: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(state)) return false;
  const row = await db.prepare(
    `SELECT 1 AS present FROM linkedin_community_oauth_states WHERE id = ? AND consumed_at IS NULL LIMIT 1`,
  ).bind(state).first<{ present: number }>();
  return Boolean(row?.present);
}

export async function startLinkedInCommunityOAuth(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
) {
  const config = configFor(env);
  if (!config) throw new LinkedInCommunityError('OAUTH_NOT_CONFIGURED', 'LinkedIn OAuth n’est pas configuré.');
  const state = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.prepare(
    `INSERT INTO linkedin_community_oauth_states
      (id, workspace_id, member_id, actor_subject, redirect_uri, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(state, principal.workspaceId, principal.memberId, principal.subject, config.redirectUri, expiresAt, now).run();

  const authorize = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('redirect_uri', config.redirectUri);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', communityScopes.join(' '));
  return { url: authorize.toString(), expiresAt };
}

async function consumeState(db: D1Database, state: string): Promise<CommunityState> {
  if (!/^[0-9a-f-]{36}$/i.test(state)) {
    throw new LinkedInCommunityError('INVALID_OAUTH_STATE', 'État OAuth LinkedIn invalide.');
  }
  const now = new Date().toISOString();
  const row = await db.prepare(
    `UPDATE linkedin_community_oauth_states SET consumed_at = ?
     WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
     RETURNING id, workspace_id, member_id, actor_subject, redirect_uri, expires_at`,
  ).bind(now, state, now).first<CommunityState>();
  if (row) return row;
  const existing = await db.prepare(
    `SELECT expires_at, consumed_at FROM linkedin_community_oauth_states WHERE id = ?`,
  ).bind(state).first<{ expires_at: string; consumed_at: string | null }>();
  if (existing && !existing.consumed_at && existing.expires_at <= now) {
    throw new LinkedInCommunityError('OAUTH_STATE_EXPIRED', 'La connexion LinkedIn a expiré.');
  }
  throw new LinkedInCommunityError('INVALID_OAUTH_STATE', 'État OAuth LinkedIn invalide ou déjà utilisé.');
}

function organizationIdFromUrn(value: unknown): string | undefined {
  const urn = str(value, 300);
  const match = urn.match(/^urn:li:organization:(\d+)$/);
  return match?.[1];
}

async function organizationDetail(fetchImpl: typeof fetch, token: string, organizationId: string): Promise<OrganizationDetail> {
  return providerJson<OrganizationDetail>(fetchImpl, `https://api.linkedin.com/rest/organizations/${encodeURIComponent(organizationId)}`, token, { method: 'GET' });
}

export async function completeLinkedInCommunityOAuth(
  db: D1Database,
  env: Env,
  input: { state: string; code: string },
  fetchImpl: typeof fetch = fetch,
) {
  const config = configFor(env);
  if (!config) throw new LinkedInCommunityError('OAUTH_NOT_CONFIGURED', 'LinkedIn OAuth n’est pas configuré.');
  if (!input.code || input.code.length > 4096) throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', 'Code OAuth LinkedIn invalide.');
  const state = await consumeState(db, input.state);
  if (state.redirect_uri !== config.redirectUri) throw new LinkedInCommunityError('INVALID_OAUTH_STATE', 'L’URL de retour LinkedIn a changé.');

  const token = await tokenExchange(fetchImpl, config, input.code);
  const accessToken = str(token.access_token, 8000);
  if (!accessToken) throw new LinkedInCommunityError('OAUTH_PROVIDER_FAILED', 'LinkedIn n’a pas retourné de jeton d’accès.');
  const scopes = scopesFrom(token.scope);
  const profile = await providerJson<UserInfo>(fetchImpl, 'https://api.linkedin.com/v2/userinfo', accessToken, { method: 'GET' });
  const memberExternalId = str(profile.sub, 255);

  const aclUrl = new URL('https://api.linkedin.com/rest/organizationAcls');
  aclUrl.searchParams.set('q', 'roleAssignee');
  aclUrl.searchParams.set('state', 'APPROVED');
  aclUrl.searchParams.set('count', '100');
  const acls = await providerJson<RestCollection<OrganizationAcl>>(fetchImpl, aclUrl.toString(), accessToken, {
    method: 'GET',
    headers: { 'X-RestLi-Method': 'FINDER' },
  });
  const eligibleRoles = new Set(['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR', 'CONTENT_ADMIN', 'DIRECT_SPONSORED_CONTENT_POSTER']);
  const eligible = (Array.isArray(acls.elements) ? acls.elements : []).filter((entry) => {
    const role = str(entry.role, 80);
    const stateValue = str(entry.state, 40);
    return stateValue === 'APPROVED' && eligibleRoles.has(role) && Boolean(organizationIdFromUrn(entry.organization ?? entry.organizationTarget));
  });
  if (!eligible.length) {
    throw new LinkedInCommunityError('NO_ORGANIZATIONS', 'Aucune Page LinkedIn administrable n’a été trouvée avec ce compte.');
  }

  const now = new Date().toISOString();
  const accessExpiresAt = expiry(token.expires_in);
  const refreshToken = str(token.refresh_token, 8000) || undefined;
  const refreshExpiresAt = expiry(token.refresh_token_expires_in);
  const connected: Array<{ connectionId: string; organizationId: string; name: string; handle?: string; role: string }> = [];

  for (const entry of eligible) {
    const organizationId = organizationIdFromUrn(entry.organization ?? entry.organizationTarget);
    if (!organizationId) continue;
    const organizationUrn = `urn:li:organization:${organizationId}`;
    const role = str(entry.role, 80);
    const detail = await organizationDetail(fetchImpl, accessToken, organizationId);
    const name = str(detail.localizedName, 255) || `Page LinkedIn ${organizationId}`;
    const handle = str(detail.vanityName, 180) || undefined;
    const existing = await db.prepare(
      `SELECT id FROM linkedin_organization_connections WHERE workspace_id = ? AND external_account_id = ? LIMIT 1`,
    ).bind(state.workspace_id, organizationId).first<{ id: string }>();
    const connectionId = existing?.id ?? `liorg:${crypto.randomUUID()}`;
    const access = await encryptToken(config.keyring, accessToken, {
      workspaceId: state.workspace_id,
      connectionId,
      provider: 'linkedin',
      kind: 'access',
    });
    const refresh = refreshToken ? await encryptToken(config.keyring, refreshToken, {
      workspaceId: state.workspace_id,
      connectionId,
      provider: 'linkedin',
      kind: 'refresh',
    }) : undefined;
    const capabilities = {
      publishing: scopes.includes('w_organization_social'),
      comments: scopes.includes('r_organization_social_feed') || scopes.includes('r_organization_social'),
      reply_comments: scopes.includes('w_organization_social_feed') || scopes.includes('w_organization_social'),
      reactions: scopes.includes('r_organization_social_feed') || scopes.includes('r_organization_social'),
      history: scopes.includes('r_organization_social'),
      analytics: true,
      direct_messages: false,
      organization_pages: true,
    };

    await db.prepare(
      `INSERT INTO linkedin_organization_connections
        (id, workspace_id, external_account_id, organization_urn, display_name, handle, admin_role, status,
         capabilities_json, access_token_ciphertext, access_token_iv, access_key_version,
         refresh_token_ciphertext, refresh_token_iv, refresh_key_version, scopes_json,
         access_expires_at, refresh_expires_at, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(workspace_id, external_account_id) DO UPDATE SET
         organization_urn = excluded.organization_urn,
         display_name = excluded.display_name,
         handle = excluded.handle,
         admin_role = excluded.admin_role,
         status = 'connected',
         capabilities_json = excluded.capabilities_json,
         access_token_ciphertext = excluded.access_token_ciphertext,
         access_token_iv = excluded.access_token_iv,
         access_key_version = excluded.access_key_version,
         refresh_token_ciphertext = COALESCE(excluded.refresh_token_ciphertext, linkedin_organization_connections.refresh_token_ciphertext),
         refresh_token_iv = COALESCE(excluded.refresh_token_iv, linkedin_organization_connections.refresh_token_iv),
         refresh_key_version = COALESCE(excluded.refresh_key_version, linkedin_organization_connections.refresh_key_version),
         scopes_json = excluded.scopes_json,
         access_expires_at = excluded.access_expires_at,
         refresh_expires_at = COALESCE(excluded.refresh_expires_at, linkedin_organization_connections.refresh_expires_at),
         updated_at = excluded.updated_at`,
    ).bind(
      connectionId,
      state.workspace_id,
      organizationId,
      organizationUrn,
      `LinkedIn Page · ${name}`,
      handle ?? null,
      role || null,
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
    ).run();

    connected.push({ connectionId, organizationId, name, handle, role });
  }

  return { workspaceId: state.workspace_id, memberExternalId, connected, scopes, accessExpiresAt };
}

function parseScopes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [];
  } catch {
    return [];
  }
}

async function loadConnections(db: D1Database, workspaceId?: string): Promise<OrganizationConnection[]> {
  const select = `SELECT id, workspace_id, external_account_id, organization_urn, display_name, handle, scopes_json,
                         access_token_ciphertext, access_token_iv, access_key_version
                  FROM linkedin_organization_connections WHERE status = 'connected'`;
  const result = workspaceId
    ? await db.prepare(`${select} AND workspace_id = ? ORDER BY display_name`).bind(workspaceId).all<OrganizationConnection>()
    : await db.prepare(`${select} ORDER BY workspace_id, display_name`).all<OrganizationConnection>();
  return result.results;
}

async function accessToken(env: Env, connection: OrganizationConnection): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new Error('Clé de chiffrement LinkedIn indisponible.');
  return decryptToken(keyring, {
    ciphertext: connection.access_token_ciphertext,
    iv: connection.access_token_iv,
    keyVersion: connection.access_key_version,
  }, {
    workspaceId: connection.workspace_id,
    connectionId: connection.id,
    provider: 'linkedin',
    kind: 'access',
  });
}

async function syncAllowed(db: D1Database, connection: OrganizationConnection): Promise<boolean> {
  const row = await db.prepare(
    `SELECT last_attempt_at FROM linkedin_runtime_sync_state WHERE workspace_id = ? AND connection_id = ?`,
  ).bind(connection.workspace_id, connection.id).first<{ last_attempt_at: string | null }>();
  if (!row?.last_attempt_at) return true;
  const last = Date.parse(row.last_attempt_at);
  return !Number.isFinite(last) || Date.now() - last >= SYNC_THROTTLE_MS;
}

async function markAttempt(db: D1Database, connection: OrganizationConnection) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO linkedin_runtime_sync_state (workspace_id, connection_id, last_attempt_at, last_success_at, last_error)
     VALUES (?, ?, ?, NULL, NULL)
     ON CONFLICT(workspace_id, connection_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_error = NULL`,
  ).bind(connection.workspace_id, connection.id, now).run();
}

async function markResult(db: D1Database, connection: OrganizationConnection, errors: string[]) {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE linkedin_runtime_sync_state SET last_success_at = ?, last_error = ? WHERE workspace_id = ? AND connection_id = ?`,
  ).bind(errors.length ? null : now, errors.length ? errors.join(' | ').slice(0, 1500) : null, connection.workspace_id, connection.id).run();
  if (!errors.length) {
    await db.prepare(
      `UPDATE linkedin_organization_connections SET last_synced_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    ).bind(now, now, connection.id, connection.workspace_id).run();
  }
}

async function fetchPosts(connection: OrganizationConnection, token: string, fetchImpl: typeof fetch): Promise<LinkedInPost[]> {
  const url = new URL('https://api.linkedin.com/rest/posts');
  url.searchParams.set('author', connection.organization_urn);
  url.searchParams.set('q', 'author');
  url.searchParams.set('count', String(MAX_POSTS));
  url.searchParams.set('sortBy', 'LAST_MODIFIED');
  const payload = await providerJson<RestCollection<LinkedInPost>>(fetchImpl, url.toString(), token, {
    method: 'GET',
    headers: { 'X-RestLi-Method': 'FINDER' },
  });
  return Array.isArray(payload.elements) ? payload.elements : [];
}

function postTime(post: LinkedInPost): string | undefined {
  return millisToIso(post.publishedAt) ?? millisToIso(post.createdAt) ?? millisToIso(post.lastModifiedAt);
}

function mediaType(post: LinkedInPost): string | undefined {
  if (!post.content || typeof post.content !== 'object') return undefined;
  const content = post.content as Record<string, unknown>;
  if (content.media) return 'media';
  if (content.multiImage) return 'multi-image';
  if (content.article) return 'article';
  if (content.poll) return 'poll';
  return undefined;
}

async function storePosts(db: D1Database, connection: OrganizationConnection, posts: LinkedInPost[]): Promise<number> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const post of posts) {
    const externalId = str(post.id, 400);
    const eventAt = postTime(post);
    if (!externalId || !eventAt) continue;
    statements.push(db.prepare(
      `INSERT INTO linkedin_remote_posts
        (id, workspace_id, connection_id, external_id, body, media_type, external_url, event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, connection_id, external_id) DO UPDATE SET
         body = excluded.body, media_type = excluded.media_type, external_url = excluded.external_url,
         event_at = excluded.event_at, updated_at = excluded.updated_at`,
    ).bind(
      `lipost:${connection.id}:${externalId}`,
      connection.workspace_id,
      connection.id,
      externalId,
      str(post.commentary, 10000) || 'Publication LinkedIn',
      mediaType(post) ?? null,
      `https://www.linkedin.com/feed/update/${externalId}/`,
      eventAt,
      now,
      now,
    ));
  }
  for (let offset = 0; offset < statements.length; offset += 50) await db.batch(statements.slice(offset, offset + 50));
  return statements.length;
}

async function upsertComment(
  db: D1Database,
  connection: OrganizationConnection,
  post: LinkedInPost,
  comment: LinkedInComment,
): Promise<boolean> {
  const commentId = str(comment.id, 240);
  const body = str(comment.message?.text, 10000);
  const actor = str(comment.actor, 400);
  const occurredAt = millisToIso(comment.created?.time);
  const postId = str(post.id, 400);
  if (!commentId || !body || !actor || !occurredAt || !postId) return false;
  const outbound = actor === connection.organization_urn;
  const actorId = actor.replace(/^urn:li:(?:person|organization|organizationBrand):/, '') || actor.slice(-40);
  const contactExternal = outbound ? `org:${connection.external_account_id}` : actor;
  const contactId = `${connection.workspace_id}:linkedin:${contactExternal}`;
  const conversationId = `${connection.id}:${contactId}`;
  const eventId = `linkedin:${connection.id}:comment:${commentId}`;
  const contactName = outbound ? connection.display_name : actor.startsWith('urn:li:organization:') ? `Organisation LinkedIn ${actorId}` : 'Membre LinkedIn';
  const context = JSON.stringify({
    source: 'linkedin',
    externalPostId: postId,
    externalUrl: `https://www.linkedin.com/feed/update/${postId}/`,
    postText: str(post.commentary, 5000),
    actor,
    commentUrn: str(comment.commentUrn, 600) || undefined,
    parentComment: str(comment.parentComment, 600) || undefined,
  });
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, created_at, updated_at)
       VALUES (?, ?, ?, 'linkedin', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
    ).bind(contactId, connection.workspace_id, contactExternal, contactName, occurredAt, now),
    db.prepare(
      `INSERT INTO conversations
        (id, workspace_id, connection_id, contact_id, status, lead_stage, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', 'Nouveau', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_message_at = MAX(COALESCE(conversations.last_message_at, ''), excluded.last_message_at),
         updated_at = excluded.updated_at`,
    ).bind(conversationId, connection.workspace_id, connection.id, contactId, occurredAt, occurredAt, now),
    db.prepare(
      `INSERT OR IGNORE INTO messages
        (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at, context_json)
       VALUES (?, ?, ?, ?, 'comment', ?, ?, ?, ?, ?)`,
    ).bind(eventId, conversationId, eventId, outbound ? 'outbound' : 'inbound', body, outbound ? 'sent' : 'received', occurredAt, now, context),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}

async function syncComments(
  db: D1Database,
  connection: OrganizationConnection,
  token: string,
  posts: LinkedInPost[],
  fetchImpl: typeof fetch,
): Promise<number> {
  let saved = 0;
  for (const post of posts.slice(0, MAX_COMMENT_POSTS)) {
    const postId = str(post.id, 400);
    if (!postId) continue;
    const url = `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postId)}/comments`;
    const payload = await providerJson<RestCollection<LinkedInComment>>(fetchImpl, url, token, { method: 'GET' });
    for (const comment of Array.isArray(payload.elements) ? payload.elements : []) {
      if (await upsertComment(db, connection, post, comment)) saved += 1;
    }
  }
  return saved;
}

async function syncOne(
  db: D1Database,
  env: Env,
  connection: OrganizationConnection,
  fetchImpl: typeof fetch,
  force: boolean,
) {
  if (!force && !await syncAllowed(db, connection)) return { skipped: true, posts: 0, comments: 0, errors: [] as string[] };
  await markAttempt(db, connection);
  const errors: string[] = [];
  let posts: LinkedInPost[] = [];
  let storedPosts = 0;
  let comments = 0;
  try {
    const token = await accessToken(env, connection);
    const scopes = parseScopes(connection.scopes_json);
    if (scopes.includes('r_organization_social')) {
      try {
        posts = await fetchPosts(connection, token, fetchImpl);
        storedPosts = await storePosts(db, connection, posts);
      } catch (error) {
        errors.push(`posts: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    if (scopes.includes('r_organization_social_feed') || scopes.includes('r_organization_social')) {
      try {
        comments = await syncComments(db, connection, token, posts, fetchImpl);
      } catch (error) {
        errors.push(`comments: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  } catch (error) {
    errors.push(`token: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  await markResult(db, connection, errors);
  return { skipped: false, posts: storedPosts, comments, errors };
}

export async function syncWorkspaceLinkedInCommunity(
  db: D1Database,
  env: Env,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
  force = false,
) {
  const connections = await loadConnections(db, workspaceId);
  const totals = { synced: 0, skipped: 0, failed: 0, posts: 0, comments: 0 };
  for (const connection of connections) {
    const result = await syncOne(db, env, connection, fetchImpl, force);
    if (result.skipped) {
      totals.skipped += 1;
      continue;
    }
    totals.synced += 1;
    totals.posts += result.posts;
    totals.comments += result.comments;
    if (result.errors.length) totals.failed += 1;
  }
  return totals;
}

export async function syncAllLinkedInCommunity(db: D1Database, env: Env, fetchImpl: typeof fetch = fetch) {
  const connections = await loadConnections(db);
  const workspaceIds = [...new Set(connections.map((connection) => connection.workspace_id))];
  const totals = { workspaces: 0, synced: 0, skipped: 0, failed: 0, posts: 0, comments: 0 };
  for (const workspaceId of workspaceIds) {
    const result = await syncWorkspaceLinkedInCommunity(db, env, workspaceId, fetchImpl);
    totals.workspaces += 1;
    totals.synced += result.synced;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
    totals.posts += result.posts;
    totals.comments += result.comments;
  }
  return totals;
}

export async function listLinkedInPlannerPublications(db: D1Database, workspaceId: string) {
  const result = await db.prepare(
    `SELECT rp.id, rp.connection_id, rp.external_id, rp.body, rp.media_type, rp.external_url,
            rp.event_at, rp.created_at, rp.updated_at, lc.display_name, lc.handle
     FROM linkedin_remote_posts rp
     JOIN linkedin_organization_connections lc ON lc.id = rp.connection_id AND lc.workspace_id = rp.workspace_id
     WHERE rp.workspace_id = ? AND lc.status = 'connected'
     ORDER BY rp.event_at ASC, rp.external_id ASC`,
  ).bind(workspaceId).all<{
    id: string;
    connection_id: string;
    external_id: string;
    body: string;
    media_type: string | null;
    external_url: string | null;
    event_at: string;
    created_at: string;
    updated_at: string;
    display_name: string;
    handle: string | null;
  }>();
  return result.results.map((row) => ({
    id: `provider:${row.id}`,
    body: row.body,
    status: 'completed',
    scheduledAt: row.event_at,
    version: 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: 'provider' as const,
    readOnly: true,
    externalUrl: row.external_url ?? undefined,
    providerStatus: 'published' as const,
    targets: [{
      id: `provider-target:${row.id}`,
      connectionId: row.connection_id,
      platform: 'linkedin' as const,
      status: 'published',
      displayName: row.display_name,
      handle: row.handle ?? undefined,
      format: 'post',
      fields: {},
      connected: true,
      connectionStatus: 'connected',
      syncStatus: 'uploaded',
      externalId: row.external_id,
      externalUrl: row.external_url ?? undefined,
      syncedAt: row.updated_at,
    }],
  }));
}
