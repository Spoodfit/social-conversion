import fs from 'node:fs';

const path = 'src/worker/cockpit-production.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes("from './social-copy-writer'")) {
  console.log('Social copy route already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Social copy route patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

replaceOnce(
`import {
  abortMediaUpload,
  completeMediaUpload,
  createMediaUpload,
  deleteMediaLibraryItem,
  getMediaLibraryItem,
  listMediaLibrary,
  MediaLibraryError,
  updateMediaLibraryItem,
  uploadMediaPart,
} from './media-library';`,
`import {
  abortMediaUpload,
  completeMediaUpload,
  createMediaUpload,
  deleteMediaLibraryItem,
  getMediaLibraryItem,
  listMediaLibrary,
  MediaLibraryError,
  updateMediaLibraryItem,
  uploadMediaPart,
} from './media-library';
import { generateSocialCopy, SocialCopyError } from './social-copy-writer';`,
'import social copy writer',
);

replaceOnce(
`async function handlePublishingApi(request: Request, env: Env, url: URL): Promise<Response> {`,
`function socialCopyErrorResponse(error: SocialCopyError): Response {
  if (error.code === 'AI_NOT_READY') return Response.json({ error: error.message, code: error.code }, { status: 503 });
  if (error.code === 'AI_PROVIDER_FAILED' || error.code === 'AI_EMPTY_RESPONSE') return Response.json({ error: error.message, code: error.code }, { status: 502 });
  return Response.json({ error: error.message, code: error.code }, { status: 400 });
}

async function handleSocialCopyApi(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateWorkspace(request, env);
  if (!auth.ok) return auth.response;
  if (!isLive(env)) return Response.json({ error: 'AI writing is locked.', code: 'LIVE_NOT_READY' }, { status: 503 });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  if (!roleCanMutate(auth.principal.role)) {
    return Response.json({ error: 'Mutation forbidden for this role.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await generateSocialCopy(env, body);
    await writeAuditLog(env.DB, auth.principal, 'ai.social_copy_generated', 'social_copy', `${result.platform}:${result.format}`, {
      objective: result.objective,
      platform: result.platform,
      format: result.format,
      model: result.model,
      fieldCount: Object.keys(result.fields).length,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof SocialCopyError) return socialCopyErrorResponse(error);
    throw error;
  }
}

async function handlePublishingApi(request: Request, env: Env, url: URL): Promise<Response> {`,
'social copy handler',
);

replaceOnce(
`    const url = new URL(request.url);
    if (url.pathname === '/api/publications' || url.pathname.startsWith('/api/publications/')) {`,
`    const url = new URL(request.url);
    if (url.pathname === '/api/ai/social-copy') {
      return handleSocialCopyApi(request, env);
    }
    if (url.pathname === '/api/publications' || url.pathname.startsWith('/api/publications/')) {`,
'route social copy before production worker',
);

fs.writeFileSync(path, source);
console.log('Social copy route applied.');
