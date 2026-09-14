import productionWorker from './production';
import { getAccessConfig, verifyAccessToken } from './auth';
import { resolveWorkspaceMembership, roleCanMutate, writeAuditLog, type WorkspacePrincipal } from './authorization';
import {
  cancelPublication,
  createPublication,
  listPublications,
  PublishingError,
} from './publishing';
import { reschedulePublication } from './publishing-reschedule';

function isLive(env: Env): boolean {
  return env.DEMO_MODE !== 'true' && String(env.LIVE_READY) === 'true';
}

async function authenticateWorkspace(request: Request, env: Env): Promise<
  | { ok: true; principal: WorkspacePrincipal }
  | { ok: false; response: Response }
> {
  const accessConfig = getAccessConfig(env);
  if (!accessConfig) {
    return { ok: false, response: Response.json({ error: 'Cloudflare Access is not configured.', code: 'ACCESS_NOT_CONFIGURED' }, { status: 503 }) };
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    return { ok: false, response: Response.json({ error: 'Authentication required.', code: 'ACCESS_TOKEN_MISSING' }, { status: 401 }) };
  }

  let identity;
  try {
    identity = await verifyAccessToken(token, accessConfig);
  } catch {
    return { ok: false, response: Response.json({ error: 'Authentication failed.', code: 'ACCESS_TOKEN_INVALID' }, { status: 401 }) };
  }

  const rateLimit = await env.API_RATE_LIMITER.limit({ key: `${identity.subject}:${request.method}:publishing` });
  if (!rateLimit.success) {
    return { ok: false, response: Response.json({ error: 'Too many requests.', code: 'RATE_LIMITED' }, { status: 429 }) };
  }

  const membership = await resolveWorkspaceMembership(env.DB, identity, request.headers.get('x-workspace-id') ?? undefined);
  if (membership.status === 'workspace_required') {
    return { ok: false, response: Response.json({ error: 'Select a workspace with the X-Workspace-Id header.', code: 'WORKSPACE_REQUIRED' }, { status: 400 }) };
  }
  if (membership.status === 'forbidden') {
    return { ok: false, response: Response.json({ error: 'Workspace access denied.', code: 'WORKSPACE_FORBIDDEN' }, { status: 403 }) };
  }
  return { ok: true, principal: membership.principal };
}

function publishingErrorResponse(error: PublishingError): Response {
  if (error.code === 'INVALID_PUBLICATION') {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  if (error.code === 'CONNECTION_NOT_FOUND' || error.code === 'PUBLICATION_NOT_FOUND') {
    return Response.json({ error: error.message, code: error.code }, { status: 404 });
  }
  if (error.code === 'CONNECTION_NOT_READY' || error.code === 'PUBLICATION_CONFLICT') {
    return Response.json({ error: error.message, code: error.code }, { status: 409 });
  }
  return Response.json({ error: error.message, code: error.code }, { status: 400 });
}

async function handlePublishingApi(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await authenticateWorkspace(request, env);
  if (!auth.ok) return auth.response;
  if (!isLive(env)) {
    return Response.json({ error: 'Live publication scheduling is locked.', code: 'LIVE_NOT_READY' }, { status: 503 });
  }

  try {
    if (url.pathname === '/api/publications' && request.method === 'GET') {
      return Response.json(await listPublications(env.DB, auth.principal.workspaceId));
    }

    if (url.pathname === '/api/publications' && request.method === 'POST') {
      if (!roleCanMutate(auth.principal.role)) {
        return Response.json({ error: 'Mutation forbidden for this role.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
      }
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const publication = await createPublication(env.DB, auth.principal, body);
      await writeAuditLog(env.DB, auth.principal, 'publication.scheduled', 'content_post', publication.id, {
        scheduledAt: publication.scheduledAt,
        targetCount: publication.targets.length,
      });
      return Response.json({ publication }, { status: 201 });
    }

    const match = url.pathname.match(/^\/api\/publications\/([^/]+)$/);
    if (match && request.method === 'PATCH') {
      if (!roleCanMutate(auth.principal.role)) {
        return Response.json({ error: 'Mutation forbidden for this role.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
      }
      const publicationId = decodeURIComponent(match[1] ?? '');
      const body = await request.json().catch(() => ({})) as { scheduledAt?: unknown; expectedVersion?: unknown };
      const publication = await reschedulePublication(
        env.DB,
        auth.principal,
        publicationId,
        body.scheduledAt,
        body.expectedVersion,
      );
      await writeAuditLog(env.DB, auth.principal, 'publication.rescheduled', 'content_post', publicationId, {
        scheduledAt: publication.scheduledAt,
        version: publication.version,
      });
      return Response.json({ publication });
    }

    if (match && request.method === 'DELETE') {
      if (!roleCanMutate(auth.principal.role)) {
        return Response.json({ error: 'Mutation forbidden for this role.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
      }
      const publicationId = decodeURIComponent(match[1] ?? '');
      const body = await request.json().catch(() => ({})) as { expectedVersion?: unknown };
      const publication = await cancelPublication(env.DB, auth.principal, publicationId, body.expectedVersion);
      await writeAuditLog(env.DB, auth.principal, 'publication.cancelled', 'content_post', publicationId, {
        version: publication.version,
      });
      return Response.json({ publication });
    }
  } catch (error) {
    if (error instanceof PublishingError) return publishingErrorResponse(error);
    throw error;
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

const cockpitProductionWorker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/publications' || url.pathname.startsWith('/api/publications/')) {
      return handlePublishingApi(request, env, url);
    }

    const response = await productionWorker.fetch(request, env, ctx);
    if (url.pathname === '/api/runtime' && request.method === 'GET' && response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = await response.json() as Record<string, unknown>;
        return Response.json({
          ...payload,
          publishingSchedulerReady: isLive(env),
          contentPublishingReady: false,
        }, {
          status: response.status,
          headers: response.headers,
        });
      }
    }
    return response;
  },
  queue: productionWorker.queue,
  scheduled: productionWorker.scheduled,
};

export default cockpitProductionWorker;
