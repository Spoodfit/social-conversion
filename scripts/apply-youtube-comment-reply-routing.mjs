import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`YouTube reply routing patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const path = 'src/worker/production.ts';
let source = fs.readFileSync(path, 'utf8');
if (source.includes('SC_YOUTUBE_COMMENT_REPLY_V1')) {
  console.log('YouTube comment reply routing already applied.');
  process.exit(0);
}

source = replaceOnce(
  source,
  `import { persistSocialEvent } from './persistence';`,
  `import { persistSocialEvent } from './persistence';\nimport { sendYouTubeCommentReply, YouTubeReplyError } from './youtube-comment-replies';`,
  'reply module import',
);

source = replaceOnce(
  source,
  `  if (!instagramOutboundConfigured(env)) {\n    return Response.json({ error: 'Instagram outbound provider is not configured.', code: 'OUTBOUND_NOT_READY' }, { status: 503 });\n  }\n\n  const body = await request.json().catch(() => undefined) as {`,
  `  const body = await request.json().catch(() => undefined) as {`,
  'defer Instagram provider gate',
);

const dispatchAnchor = `  try {\n    const outbox = await enqueueOutbound(env.DB, {`;
const providerBlock = `  const conversation = await env.DB.prepare(\n    \`SELECT sc.platform\n     FROM conversations c\n     JOIN social_connections sc ON sc.id = c.connection_id AND sc.workspace_id = c.workspace_id\n     WHERE c.id = ? AND c.workspace_id = ?\`,\n  ).bind(body.conversationId, auth.principal.workspaceId).first<{ platform: string }>();\n\n  if (!conversation) {\n    return Response.json({ error: 'Conversation introuvable.', code: 'CONVERSATION_NOT_FOUND' }, { status: 404 });\n  }\n\n  if (conversation.platform === 'youtube') {\n    try {\n      const result = await sendYouTubeCommentReply(env.DB, env, auth.principal.workspaceId, body.conversationId, body.message);\n      await writeAuditLog(env.DB, auth.principal, 'message.youtube_comment_replied', 'message', result.id, {\n        conversationId: body.conversationId,\n        providerId: result.providerId,\n      });\n      return Response.json(result, { status: 200 });\n    } catch (error) {\n      if (error instanceof YouTubeReplyError) {\n        const status = error.code === 'CONVERSATION_NOT_FOUND' ? 404\n          : error.code === 'NOT_YOUTUBE_COMMENT' || error.code === 'OAUTH_SCOPE_MISSING' ? 409\n            : error.code === 'OAUTH_NOT_READY' ? 503\n              : 502;\n        return Response.json({ error: error.message, code: error.code }, { status });\n      }\n      throw error;\n    }\n  }\n\n  if (!instagramOutboundConfigured(env)) {\n    return Response.json({ error: 'Le connecteur de réponse de ce réseau n’est pas disponible.', code: 'OUTBOUND_NOT_READY' }, { status: 503 });\n  }\n\n${dispatchAnchor}`;
source = replaceOnce(source, dispatchAnchor, providerBlock, 'provider-aware reply routing');
source += '\n// SC_YOUTUBE_COMMENT_REPLY_V1\n';
fs.writeFileSync(path, source);
console.log('Confirmed YouTube comment reply routing applied.');
