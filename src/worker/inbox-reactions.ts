import { decryptToken, tokenKeyringSecret } from './token-vault';

export type InboxReactionType =
  | 'LIKE'
  | 'PRAISE'
  | 'EMPATHY'
  | 'INTEREST'
  | 'APPRECIATION'
  | 'ENTERTAINMENT';

const LINKEDIN_REACTIONS: InboxReactionType[] = [
  'LIKE',
  'PRAISE',
  'EMPATHY',
  'INTEREST',
  'APPRECIATION',
  'ENTERTAINMENT',
];
const FACEBOOK_REACTIONS: InboxReactionType[] = ['LIKE'];
const LINKEDIN_VERSION = '202608';

type ReactionTarget = {
  message_id: string;
  external_id: string | null;
  direction: 'inbound' | 'outbound';
  message_type: string;
  context_json: string | null;
  connection_id: string;
  platform: string;
};

type ConversationTarget = {
  connection_id: string;
  platform: string;
};

type FacebookConnection = {
  id: string;
  workspace_id: string;
  external_account_id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_key_version: string;
  scopes_json: string;
};

type LinkedInConnection = {
  id: string;
  workspace_id: string;
  organization_urn: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_key_version: string;
  scopes_json: string;
};

export class InboxReactionError extends Error {
  readonly code:
    | 'REACTION_INVALID'
    | 'REACTION_NOT_SUPPORTED'
    | 'REACTION_TARGET_NOT_FOUND'
    | 'REACTION_SCOPE_MISSING'
    | 'REACTION_PROVIDER_FAILED'
    | 'REACTION_CONFIGURATION_MISSING';

  constructor(code: InboxReactionError['code'], message: string) {
    super(message);
    this.name = 'InboxReactionError';
    this.code = code;
  }
}

function parseScopes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [];
  } catch {
    return [];
  }
}

function graphVersion(env: Env): string {
  const raw = Reflect.get(env, 'META_GRAPH_VERSION');
  return typeof raw === 'string' && /^v\d{1,3}\.\d{1,2}$/.test(raw) ? raw : 'v24.0';
}

function providerDetail(text: string): string {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const value = parsed.error?.message ?? parsed.message;
    return typeof value === 'string' ? value.slice(0, 300) : text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await response.text().catch(() => '');
    return { response, body };
  } catch {
    throw new InboxReactionError('REACTION_PROVIDER_FAILED', 'Le réseau social n’a pas répondu à temps.');
  } finally {
    clearTimeout(timeout);
  }
}

async function loadConversationTarget(
  db: D1Database,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationTarget> {
  const row = await db.prepare(
    `SELECT c.connection_id, ct.platform
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id
     WHERE c.workspace_id = ? AND c.id = ?
     LIMIT 1`,
  ).bind(workspaceId, conversationId).first<ConversationTarget>();
  if (!row) throw new InboxReactionError('REACTION_TARGET_NOT_FOUND', 'Cette conversation n’existe plus.');
  return row;
}

async function loadMessageTarget(
  db: D1Database,
  workspaceId: string,
  conversationId: string,
  messageId: string,
): Promise<ReactionTarget> {
  const row = await db.prepare(
    `SELECT m.id AS message_id, m.external_id, m.direction, m.message_type, m.context_json,
            c.connection_id, ct.platform
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id
     WHERE c.workspace_id = ? AND c.id = ? AND m.id = ?
     LIMIT 1`,
  ).bind(workspaceId, conversationId, messageId).first<ReactionTarget>();
  if (!row) throw new InboxReactionError('REACTION_TARGET_NOT_FOUND', 'Cette interaction n’existe plus. Actualisez l’Inbox.');
  if (row.direction !== 'inbound' || row.message_type !== 'comment') {
    throw new InboxReactionError('REACTION_NOT_SUPPORTED', 'Les réactions sont disponibles uniquement sur les commentaires reçus.');
  }
  return row;
}

async function facebookConnection(
  db: D1Database,
  workspaceId: string,
  connectionId: string,
): Promise<FacebookConnection | undefined> {
  return db.prepare(
    `SELECT id, workspace_id, external_account_id,
            access_token_ciphertext, access_token_iv, access_key_version, scopes_json
     FROM facebook_connections
     WHERE workspace_id = ? AND id = ? AND status = 'connected'
     LIMIT 1`,
  ).bind(workspaceId, connectionId).first<FacebookConnection>();
}

async function linkedinConnection(
  db: D1Database,
  workspaceId: string,
  connectionId: string,
): Promise<LinkedInConnection | undefined> {
  return db.prepare(
    `SELECT id, workspace_id, organization_urn,
            access_token_ciphertext, access_token_iv, access_key_version, scopes_json
     FROM linkedin_organization_connections
     WHERE workspace_id = ? AND id = ? AND status = 'connected'
     LIMIT 1`,
  ).bind(workspaceId, connectionId).first<LinkedInConnection>();
}

async function supportedReactionTypes(
  db: D1Database,
  workspaceId: string,
  target: ConversationTarget,
): Promise<{ platform: string; reactionTypes: InboxReactionType[]; reason?: string }> {
  if (target.platform === 'facebook') {
    const connection = await facebookConnection(db, workspaceId, target.connection_id);
    if (!connection) return { platform: target.platform, reactionTypes: [], reason: 'Compte Facebook non disponible.' };
    if (!parseScopes(connection.scopes_json).includes('pages_manage_engagement')) {
      return { platform: target.platform, reactionTypes: [], reason: 'Permission Facebook pages_manage_engagement manquante.' };
    }
    return { platform: target.platform, reactionTypes: FACEBOOK_REACTIONS };
  }

  if (target.platform === 'linkedin') {
    const connection = await linkedinConnection(db, workspaceId, target.connection_id);
    if (!connection) return { platform: target.platform, reactionTypes: [], reason: 'Page LinkedIn non disponible.' };
    const scopes = parseScopes(connection.scopes_json);
    if (!scopes.includes('w_organization_social_feed') && !scopes.includes('w_organization_social')) {
      return { platform: target.platform, reactionTypes: [], reason: 'Permission LinkedIn de réaction manquante.' };
    }
    return { platform: target.platform, reactionTypes: LINKEDIN_REACTIONS };
  }

  return { platform: target.platform, reactionTypes: [] };
}

export async function listInboxReactionState(
  db: D1Database,
  workspaceId: string,
  conversationId: string,
) {
  const target = await loadConversationTarget(db, workspaceId, conversationId);
  const capability = await supportedReactionTypes(db, workspaceId, target);
  if (!capability.reactionTypes.length) {
    return {
      supported: false,
      platform: capability.platform,
      reactionTypes: [] as InboxReactionType[],
      reactions: {} as Record<string, InboxReactionType>,
      reason: capability.reason,
    };
  }

  const result = await db.prepare(
    `SELECT message_id, reaction_type
     FROM inbox_message_reactions
     WHERE workspace_id = ? AND conversation_id = ?`,
  ).bind(workspaceId, conversationId).all<{ message_id: string; reaction_type: InboxReactionType }>();
  const reactions: Record<string, InboxReactionType> = {};
  for (const row of result.results) {
    if (capability.reactionTypes.includes(row.reaction_type)) reactions[row.message_id] = row.reaction_type;
  }
  return {
    supported: true,
    platform: capability.platform,
    reactionTypes: capability.reactionTypes,
    reactions,
  };
}

async function decryptFacebookToken(env: Env, connection: FacebookConnection): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new InboxReactionError('REACTION_CONFIGURATION_MISSING', 'Le coffre de jetons Facebook n’est pas configuré.');
  return decryptToken(keyring, {
    ciphertext: connection.access_token_ciphertext,
    iv: connection.access_token_iv,
    keyVersion: connection.access_key_version,
  }, {
    workspaceId: connection.workspace_id,
    connectionId: connection.id,
    provider: 'facebook',
    kind: 'access',
  });
}

async function decryptLinkedInToken(env: Env, connection: LinkedInConnection): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new InboxReactionError('REACTION_CONFIGURATION_MISSING', 'Le coffre de jetons LinkedIn n’est pas configuré.');
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

function rawFacebookCommentId(target: ReactionTarget): string {
  const value = (target.external_id ?? '').trim();
  if (!value || value.length > 300 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new InboxReactionError('REACTION_TARGET_NOT_FOUND', 'Identifiant du commentaire Facebook invalide.');
  }
  return value;
}

function linkedinCommentUrn(target: ReactionTarget): string {
  const raw = (target.external_id ?? '').trim();
  const prefix = `linkedin:${target.connection_id}:comment:`;
  const commentId = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  if (commentId.startsWith('urn:li:comment:')) return commentId;
  if (!/^[A-Za-z0-9_-]{1,240}$/.test(commentId)) {
    throw new InboxReactionError('REACTION_TARGET_NOT_FOUND', 'Identifiant du commentaire LinkedIn invalide.');
  }
  let postId = '';
  try {
    const context = JSON.parse(target.context_json ?? '{}') as { externalPostId?: unknown; externalContentId?: unknown };
    const candidate = context.externalPostId ?? context.externalContentId;
    if (typeof candidate === 'string') postId = candidate.trim();
  } catch {
    postId = '';
  }
  if (!/^urn:li:(?:activity|share|ugcPost):[A-Za-z0-9_-]+$/.test(postId)) {
    throw new InboxReactionError('REACTION_TARGET_NOT_FOUND', 'Le Thread LinkedIn d’origine est introuvable. Actualisez l’Inbox.');
  }
  return `urn:li:comment:(${postId},${commentId})`;
}

async function setFacebookLike(
  env: Env,
  connection: FacebookConnection,
  target: ReactionTarget,
  active: boolean,
  fetchImpl: typeof fetch,
) {
  const scopes = parseScopes(connection.scopes_json);
  if (!scopes.includes('pages_manage_engagement')) {
    throw new InboxReactionError('REACTION_SCOPE_MISSING', 'Reconnectez Facebook pour autoriser les réactions aux commentaires.');
  }
  const token = await decryptFacebookToken(env, connection);
  const commentId = rawFacebookCommentId(target);
  const url = `https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(commentId)}/likes`;
  const { response, body } = await fetchWithTimeout(fetchImpl, url, {
    method: active ? 'POST' : 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok && !(response.status === 404 && !active)) {
    throw new InboxReactionError(
      response.status === 401 || response.status === 403 ? 'REACTION_SCOPE_MISSING' : 'REACTION_PROVIDER_FAILED',
      `Facebook a refusé la réaction (${response.status})${body ? ` : ${providerDetail(body)}` : ''}`,
    );
  }
}

function linkedinHeaders(token: string, contentType = false): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...(contentType ? { 'content-type': 'application/json' } : {}),
  };
}

async function deleteLinkedInReaction(
  connection: LinkedInConnection,
  token: string,
  commentUrn: string,
  fetchImpl: typeof fetch,
) {
  const url = `https://api.linkedin.com/rest/reactions/(actor:${encodeURIComponent(connection.organization_urn)},entity:${encodeURIComponent(commentUrn)})`;
  const { response, body } = await fetchWithTimeout(fetchImpl, url, {
    method: 'DELETE',
    headers: linkedinHeaders(token),
  });
  if (!response.ok && response.status !== 404) {
    throw new InboxReactionError(
      response.status === 401 || response.status === 403 ? 'REACTION_SCOPE_MISSING' : 'REACTION_PROVIDER_FAILED',
      `LinkedIn a refusé la suppression de la réaction (${response.status})${body ? ` : ${providerDetail(body)}` : ''}`,
    );
  }
}

async function createLinkedInReaction(
  connection: LinkedInConnection,
  token: string,
  commentUrn: string,
  reactionType: InboxReactionType,
  fetchImpl: typeof fetch,
) {
  const url = `https://api.linkedin.com/rest/reactions?actor=${encodeURIComponent(connection.organization_urn)}`;
  const { response, body } = await fetchWithTimeout(fetchImpl, url, {
    method: 'POST',
    headers: linkedinHeaders(token, true),
    body: JSON.stringify({ root: commentUrn, reactionType }),
  });
  if (!response.ok) {
    throw new InboxReactionError(
      response.status === 401 || response.status === 403 ? 'REACTION_SCOPE_MISSING' : 'REACTION_PROVIDER_FAILED',
      `LinkedIn a refusé la réaction (${response.status})${body ? ` : ${providerDetail(body)}` : ''}`,
    );
  }
}

async function setLinkedInReaction(
  db: D1Database,
  env: Env,
  workspaceId: string,
  target: ReactionTarget,
  oldReaction: InboxReactionType | undefined,
  newReaction: InboxReactionType | undefined,
  fetchImpl: typeof fetch,
) {
  const connection = await linkedinConnection(db, workspaceId, target.connection_id);
  if (!connection) throw new InboxReactionError('REACTION_TARGET_NOT_FOUND', 'La Page LinkedIn connectée n’est plus disponible.');
  const scopes = parseScopes(connection.scopes_json);
  if (!scopes.includes('w_organization_social_feed') && !scopes.includes('w_organization_social')) {
    throw new InboxReactionError('REACTION_SCOPE_MISSING', 'Reconnectez LinkedIn avec la permission permettant de réagir au nom de la Page.');
  }
  const token = await decryptLinkedInToken(env, connection);
  const commentUrn = linkedinCommentUrn(target);
  if (oldReaction) await deleteLinkedInReaction(connection, token, commentUrn, fetchImpl);
  if (newReaction) await createLinkedInReaction(connection, token, commentUrn, newReaction, fetchImpl);
}

export async function toggleInboxReaction(
  db: D1Database,
  env: Env,
  workspaceId: string,
  conversationId: string,
  messageId: string,
  requestedReaction: string,
  fetchImpl: typeof fetch = fetch,
) {
  const target = await loadMessageTarget(db, workspaceId, conversationId, messageId);
  const capability = await supportedReactionTypes(db, workspaceId, target);
  if (!capability.reactionTypes.length) {
    throw new InboxReactionError('REACTION_NOT_SUPPORTED', 'Ce réseau ne permet pas de réagir à cette interaction via son API publique.');
  }
  if (!capability.reactionTypes.includes(requestedReaction as InboxReactionType)) {
    throw new InboxReactionError('REACTION_INVALID', 'Cette réaction n’est pas disponible sur ce réseau.');
  }
  const requested = requestedReaction as InboxReactionType;
  const currentRow = await db.prepare(
    `SELECT reaction_type FROM inbox_message_reactions
     WHERE workspace_id = ? AND message_id = ? LIMIT 1`,
  ).bind(workspaceId, messageId).first<{ reaction_type: InboxReactionType }>();
  const current = currentRow?.reaction_type;
  const next = current === requested ? undefined : requested;

  if (target.platform === 'facebook') {
    const connection = await facebookConnection(db, workspaceId, target.connection_id);
    if (!connection) throw new InboxReactionError('REACTION_TARGET_NOT_FOUND', 'La Page Facebook connectée n’est plus disponible.');
    await setFacebookLike(env, connection, target, Boolean(next), fetchImpl);
  } else if (target.platform === 'linkedin') {
    await setLinkedInReaction(db, env, workspaceId, target, current, next, fetchImpl);
  } else {
    throw new InboxReactionError('REACTION_NOT_SUPPORTED', 'Ce réseau ne permet pas cette réaction via son API publique.');
  }

  const now = new Date().toISOString();
  if (next) {
    await db.prepare(
      `INSERT INTO inbox_message_reactions
         (workspace_id, conversation_id, message_id, platform, reaction_type, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, message_id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         platform = excluded.platform,
         reaction_type = excluded.reaction_type,
         updated_at = excluded.updated_at`,
    ).bind(workspaceId, conversationId, messageId, target.platform, next, now).run();
  } else {
    await db.prepare(
      `DELETE FROM inbox_message_reactions WHERE workspace_id = ? AND message_id = ?`,
    ).bind(workspaceId, messageId).run();
  }

  return {
    messageId,
    platform: target.platform,
    reactionType: next ?? null,
  };
}
