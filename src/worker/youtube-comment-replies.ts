import { loadOAuthTokens, saveOAuthCredentials, tokenKeyringSecret } from './token-vault';

export class YouTubeReplyError extends Error {
  readonly code:
    | 'CONVERSATION_NOT_FOUND'
    | 'NOT_YOUTUBE_COMMENT'
    | 'OAUTH_NOT_READY'
    | 'OAUTH_SCOPE_MISSING'
    | 'PROVIDER_FAILED';

  constructor(code: YouTubeReplyError['code'], message: string) {
    super(message);
    this.name = 'YouTubeReplyError';
    this.code = code;
  }
}

type ConversationRow = {
  connection_id: string;
  platform: string;
  message_id: string | null;
  external_id: string | null;
  message_type: string | null;
  context_json: string | null;
};

function envString(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new YouTubeReplyError('PROVIDER_FAILED', 'YouTube a retourné une réponse invalide.');
  }
}

async function refreshYouTubeAccessToken(
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
    throw new YouTubeReplyError('OAUTH_NOT_READY', 'La connexion YouTube doit être reconnectée.');
  }
  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connectionId);
  if (!tokens || tokens.credentials.provider !== 'youtube' || !tokens.refreshToken) {
    throw new YouTubeReplyError('OAUTH_NOT_READY', 'Les identifiants YouTube ne sont plus disponibles. Reconnectez la chaîne.');
  }
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!response.ok) throw new YouTubeReplyError('PROVIDER_FAILED', `Le renouvellement YouTube a échoué (${response.status}).`);
  const payload = await readJson(response) as { access_token?: unknown; expires_in?: unknown };
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
  if (!accessToken) throw new YouTubeReplyError('PROVIDER_FAILED', 'YouTube n’a pas retourné de jeton valide.');
  const expiresIn = Number(payload.expires_in) || 3600;
  await saveOAuthCredentials(db, keyring, {
    workspaceId,
    connectionId,
    provider: 'youtube',
    accessToken,
    scopes: tokens.credentials.scopes,
    accessExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  });
  return accessToken;
}

async function youtubeAccessToken(
  db: D1Database,
  env: Env,
  workspaceId: string,
  connectionId: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const keyring = tokenKeyringSecret(env);
  if (!keyring) throw new YouTubeReplyError('OAUTH_NOT_READY', 'Le chiffrement OAuth YouTube n’est pas configuré.');
  const tokens = await loadOAuthTokens(db, keyring, workspaceId, connectionId);
  if (!tokens || tokens.credentials.provider !== 'youtube') {
    throw new YouTubeReplyError('OAUTH_NOT_READY', 'Les identifiants YouTube ne sont plus disponibles.');
  }
  if (!tokens.credentials.scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl')) {
    throw new YouTubeReplyError('OAUTH_SCOPE_MISSING', 'Reconnectez YouTube pour autoriser les réponses aux commentaires.');
  }
  const expiresAt = tokens.credentials.accessExpiresAt ? Date.parse(tokens.credentials.accessExpiresAt) : Number.POSITIVE_INFINITY;
  if (expiresAt > Date.now() + 120_000) return tokens.accessToken;
  return refreshYouTubeAccessToken(db, env, workspaceId, connectionId, fetchImpl);
}

function rawYouTubeCommentId(row: ConversationRow): string | undefined {
  const external = row.external_id?.trim();
  if (external && !external.includes(':youtube-comment:')) return external;
  if (external?.includes(':youtube-comment:')) return external.split(':youtube-comment:').pop() || undefined;
  const messageId = row.message_id?.trim();
  if (messageId?.includes(':youtube-comment:')) return messageId.split(':youtube-comment:').pop() || undefined;
  return undefined;
}

export async function sendYouTubeCommentReply(
  db: D1Database,
  env: Env,
  workspaceId: string,
  conversationId: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
) {
  const text = body.trim();
  if (!text || text.length > 10_000) throw new YouTubeReplyError('PROVIDER_FAILED', 'La réponse YouTube est vide ou trop longue.');

  const row = await db.prepare(
    `SELECT c.connection_id, sc.platform,
            m.id AS message_id, m.external_id, m.message_type, m.context_json
     FROM conversations c
     JOIN social_connections sc ON sc.id = c.connection_id AND sc.workspace_id = c.workspace_id
     LEFT JOIN messages m ON m.id = (
       SELECT m2.id FROM messages m2
       WHERE m2.conversation_id = c.id AND m2.direction = 'inbound'
       ORDER BY m2.sent_at DESC, m2.id DESC LIMIT 1
     )
     WHERE c.id = ? AND c.workspace_id = ?`,
  ).bind(conversationId, workspaceId).first<ConversationRow>();

  if (!row) throw new YouTubeReplyError('CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
  if (row.platform !== 'youtube' || row.message_type !== 'comment') {
    throw new YouTubeReplyError('NOT_YOUTUBE_COMMENT', 'Cette conversation n’est pas un commentaire YouTube répondable.');
  }
  const parentId = rawYouTubeCommentId(row);
  if (!parentId) throw new YouTubeReplyError('PROVIDER_FAILED', 'Le commentaire YouTube source ne peut pas être identifié.');

  let accessToken = await youtubeAccessToken(db, env, workspaceId, row.connection_id, fetchImpl);
  const url = new URL('https://www.googleapis.com/youtube/v3/comments');
  url.searchParams.set('part', 'snippet');
  const requestBody = JSON.stringify({ snippet: { parentId, textOriginal: text } });

  const send = (token: string) => fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: requestBody,
  });

  let response = await send(accessToken);
  if (response.status === 401) {
    accessToken = await refreshYouTubeAccessToken(db, env, workspaceId, row.connection_id, fetchImpl);
    response = await send(accessToken);
  }
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    console.warn(JSON.stringify({ event: 'youtube_comment_reply_failed', status: response.status, conversationId, details: details.slice(0, 300) }));
    throw new YouTubeReplyError('PROVIDER_FAILED', `YouTube a refusé la réponse (${response.status}).`);
  }

  const payload = await readJson(response) as { id?: unknown; snippet?: { textDisplay?: unknown; textOriginal?: unknown; publishedAt?: unknown } };
  const providerId = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : undefined;
  if (!providerId) throw new YouTubeReplyError('PROVIDER_FAILED', 'YouTube n’a pas confirmé la création de la réponse.');
  const sentAt = typeof payload.snippet?.publishedAt === 'string' && Number.isFinite(Date.parse(payload.snippet.publishedAt))
    ? new Date(payload.snippet.publishedAt).toISOString()
    : new Date().toISOString();
  const savedBody = typeof payload.snippet?.textOriginal === 'string' && payload.snippet.textOriginal.trim()
    ? payload.snippet.textOriginal.trim()
    : text;
  const id = `${row.connection_id}:youtube-reply:${providerId}`;

  await db.batch([
    db.prepare(
      `INSERT OR REPLACE INTO messages
        (id, conversation_id, external_id, direction, message_type, body, status, ai_assisted, context_json, sent_at, created_at)
       VALUES (?, ?, ?, 'outbound', 'comment', ?, 'sent', 0, ?, ?, ?)`,
    ).bind(id, conversationId, providerId, savedBody, row.context_json, sentAt, sentAt),
    db.prepare(
      `UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    ).bind(sentAt, sentAt, conversationId, workspaceId),
  ]);

  return {
    id,
    providerId,
    status: 'sent' as const,
    message: {
      id,
      externalId: providerId,
      direction: 'outbound' as const,
      type: 'comment',
      body: savedBody,
      status: 'sent',
      aiAssisted: false,
      sentAt,
      createdAt: sentAt,
    },
  };
}
