import type { WorkspacePrincipal } from './authorization';
import { loadOAuthTokens, saveOAuthCredentials, tokenKeyringSecret } from './token-vault';

const YOUTUBE_FORCE_SSL = 'https://www.googleapis.com/auth/youtube.force-ssl';

type ConversationReplyTarget = {
  conversation_id: string;
  connection_id: string;
  platform: string;
  external_comment_id: string | null;
  context_json: string | null;
};

export class YouTubeCommentReplyError extends Error {
  readonly code:
    | 'CONVERSATION_NOT_FOUND'
    | 'NOT_YOUTUBE_COMMENT'
    | 'YOUTUBE_NOT_READY'
    | 'YOUTUBE_SCOPE_MISSING'
    | 'YOUTUBE_PROVIDER_FAILED';

  constructor(code: YouTubeCommentReplyError['code'], message: string) {
    super(message);
    this.name = 'YouTubeCommentReplyError';
    this.code = code;
  }
}

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new YouTubeCommentReplyError('YOUTUBE_PROVIDER_FAILED', 'YouTube a retourné une réponse invalide.');
  }
}

async function refreshToken(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connectionId: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  const clientId = envString(env, 'YOUTUBE_CLIENT_ID');
  const clientSecret = envString(env, 'YOUTUBE_CLIENT_SECRET');
  if (!keyring || !clientId || !clientSecret) {
    throw new YouTubeCommentReplyError('YOUTUBE_NOT_READY', 'La configuration YouTube est incomplète.');
  }
  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connectionId);
  if (!tokens || tokens.credentials.provider !== 'youtube' || !tokens.refreshToken) {
    throw new YouTubeCommentReplyError('YOUTUBE_NOT_READY', 'Reconnectez la chaîne YouTube.');
  }

  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!response.ok) {
    throw new YouTubeCommentReplyError('YOUTUBE_PROVIDER_FAILED', `Le renouvellement YouTube a échoué (${response.status}).`);
  }
  const payload = await readJson(response) as { access_token?: unknown; expires_in?: unknown };
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
  if (!accessToken) throw new YouTubeCommentReplyError('YOUTUBE_PROVIDER_FAILED', 'YouTube n’a pas retourné de jeton valide.');

  await saveOAuthCredentials(db, keyring, {
    workspaceId,
    connectionId,
    provider: 'youtube',
    accessToken,
    scopes: tokens.credentials.scopes,
    accessExpiresAt: new Date(Date.now() + (Number(payload.expires_in) || 3600) * 1000).toISOString(),
  });
  return accessToken;
}

async function accessToken(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connectionId: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new YouTubeCommentReplyError('YOUTUBE_NOT_READY', 'La configuration de chiffrement YouTube est absente.');
  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connectionId);
  if (!tokens || tokens.credentials.provider !== 'youtube') {
    throw new YouTubeCommentReplyError('YOUTUBE_NOT_READY', 'Reconnectez la chaîne YouTube.');
  }
  if (!tokens.credentials.scopes.includes(YOUTUBE_FORCE_SSL)) {
    throw new YouTubeCommentReplyError('YOUTUBE_SCOPE_MISSING', 'Reconnectez la chaîne YouTube pour autoriser les réponses aux commentaires.');
  }
  const expiresAt = tokens.credentials.accessExpiresAt ? Date.parse(tokens.credentials.accessExpiresAt) : Number.POSITIVE_INFINITY;
  if (expiresAt > Date.now() + 120_000) return tokens.accessToken;
  return refreshToken(db, env, workspaceId, connectionId, fetchImpl);
}

export async function sendYouTubeCommentReply(
  db: D1Database,
  env: Env,
  principal: WorkspacePrincipal,
  conversationId: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
) {
  const text = body.trim();
  if (!text || text.length > 10_000) {
    throw new YouTubeCommentReplyError('YOUTUBE_PROVIDER_FAILED', 'La réponse YouTube est vide ou trop longue.');
  }

  const target = await db.prepare(
    `SELECT c.id AS conversation_id, c.connection_id, sc.platform,
            (SELECT m.external_id FROM messages m
             WHERE m.conversation_id = c.id AND m.direction = 'inbound' AND m.message_type = 'comment'
             ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS external_comment_id,
            (SELECT m.context_json FROM messages m
             WHERE m.conversation_id = c.id AND m.direction = 'inbound' AND m.message_type = 'comment'
             ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS context_json
     FROM conversations c
     JOIN social_connections sc ON sc.id = c.connection_id AND sc.workspace_id = c.workspace_id
     WHERE c.id = ? AND c.workspace_id = ?`,
  ).bind(conversationId, principal.workspaceId).first<ConversationReplyTarget>();

  if (!target) throw new YouTubeCommentReplyError('CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
  if (target.platform !== 'youtube' || !target.external_comment_id) {
    throw new YouTubeCommentReplyError('NOT_YOUTUBE_COMMENT', 'Cette conversation n’est pas un commentaire YouTube répondable.');
  }

  let token = await accessToken(db, env, principal.workspaceId, target.connection_id, fetchImpl);
  const endpoint = 'https://www.googleapis.com/youtube/v3/comments?part=snippet';
  const requestBody = JSON.stringify({ snippet: { parentId: target.external_comment_id, textOriginal: text } });

  const callProvider = (bearer: string) => fetchImpl(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: requestBody,
  });

  let response = await callProvider(token);
  if (response.status === 401) {
    token = await refreshToken(db, env, principal.workspaceId, target.connection_id, fetchImpl);
    response = await callProvider(token);
  }
  if (!response.ok) {
    const providerBody = await response.text().catch(() => '');
    console.warn(JSON.stringify({
      event: 'youtube_comment_reply_failed',
      workspaceId: principal.workspaceId,
      conversationId,
      status: response.status,
      providerBody: providerBody.slice(0, 500),
    }));
    throw new YouTubeCommentReplyError('YOUTUBE_PROVIDER_FAILED', `YouTube a refusé la réponse (${response.status}).`);
  }

  const payload = await readJson(response) as {
    id?: unknown;
    snippet?: { textOriginal?: unknown; publishedAt?: unknown };
  };
  const externalId = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : crypto.randomUUID();
  const sentAtRaw = typeof payload.snippet?.publishedAt === 'string' ? payload.snippet.publishedAt : new Date().toISOString();
  const sentAt = Number.isFinite(Date.parse(sentAtRaw)) ? new Date(sentAtRaw).toISOString() : new Date().toISOString();
  const now = new Date().toISOString();
  const id = `${target.connection_id}:youtube-reply:${externalId}`;

  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO messages
        (id, conversation_id, external_id, direction, message_type, body, status, ai_assisted, context_json, sent_at, created_at)
       VALUES (?, ?, ?, 'outbound', 'comment', ?, 'sent', 0, ?, ?, ?)`,
    ).bind(id, conversationId, externalId, text, target.context_json, sentAt, now),
    db.prepare(
      `UPDATE conversations SET last_message_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(sentAt, now, conversationId, principal.workspaceId),
  ]);

  return {
    id,
    status: 'sent' as const,
    provider: 'youtube' as const,
    message: {
      id,
      externalId,
      direction: 'outbound' as const,
      type: 'comment',
      body: text,
      status: 'sent',
      aiAssisted: false,
      sentAt,
      createdAt: now,
    },
  };
}
