import baseWorker from './index';
import { getAccessConfig, verifyAccessToken } from './auth';
import { resolveWorkspaceMembership, roleCanMutate, writeAuditLog, type WorkspacePrincipal } from './authorization';
import {
  completeInstagramOAuth,
  InstagramOAuthError,
  instagramOAuthConfigured,
  refreshExpiringInstagramTokens,
  startInstagramOAuth,
} from './instagram-oauth';
import {
  deliverInstagramOutbound,
  instagramOutboundConfigured,
  type OutboundDeliveryEnvelope,
} from './instagram-outbound';
import {
  OutboxError,
  claimOutboundForDelivery,
  enqueueOutbound,
  listDispatchableOutbound,
} from './outbox';
import { persistSocialEvent } from './persistence';
import type { NormalizedSocialEvent } from '../shared/types';

type ProductionQueueMessage = NormalizedSocialEvent | OutboundDeliveryEnvelope;

function isOutboundEnvelope(value: unknown): value is OutboundDeliveryEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<OutboundDeliveryEnvelope>;
  return candidate.kind === 'outbound_delivery'
    && typeof candidate.id === 'string'
    && typeof candidate.workspaceId === 'string';
}

function isLive(env: Env): boolean {
  return env.DEMO_MODE !== 'true' && String(env.LIVE_READY) === 'true';
}

async function authenticateMutation(request: Request, env: Env, path: string): Promise<
  | { ok: true; principal: WorkspacePrincipal }
  | { ok: false; response: Response }
> {
  const accessConfig = getAccessConfig(env);
  if (!accessConfig) {
    return {
      ok: false,
      response: Response.json({ error: 'Cloudflare Access is not configured.', code: 'ACCESS_NOT_CONFIGURED' }, { status: 503 }),
    };
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    return {
      ok: false,
      response: Response.json({ error: 'Authentication required.', code: 'ACCESS_TOKEN_MISSING' }, { status: 401 }),
    };
  }

  let identity;
  try {
    identity = await verifyAccessToken(token, accessConfig);
  } catch {
    console.warn(JSON.stringify({ event: 'access_token_rejected', path }));
    return {
      ok: false,
      response: Response.json({ error: 'Authentication failed.', code: 'ACCESS_TOKEN_INVALID' }, { status: 401 }),
    };
  }

  const rateLimit = await env.API_RATE_LIMITER.limit({ key: `${identity.subject}:${request.method}:${path}` });
  if (!rateLimit.success) {
    return {
      ok: false,
      response: Response.json({ error: 'Too many requests.', code: 'RATE_LIMITED' }, { status: 429 }),
    };
  }

  const requestedWorkspaceId = request.headers.get('x-workspace-id') ?? undefined;
  const membership = await resolveWorkspaceMembership(env.DB, identity, requestedWorkspaceId);
  if (membership.status === 'workspace_required') {
    return {
      ok: false,
      response: Response.json({ error: 'Select a workspace with the X-Workspace-Id header.', code: 'WORKSPACE_REQUIRED' }, { status: 400 }),
    };
  }
  if (membership.status === 'forbidden') {
    return {
      ok: false,
      response: Response.json({ error: 'Workspace access denied.', code: 'WORKSPACE_FORBIDDEN' }, { status: 403 }),
    };
  }
  if (!roleCanMutate(membership.principal.role)) {
    return {
      ok: false,
      response: Response.json({ error: 'Mutation forbidden for this role.', code: 'ROLE_FORBIDDEN' }, { status: 403 }),
    };
  }
  return { ok: true, principal: membership.principal };
}

async function handleOutboundApi(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateMutation(request, env, '/api/messages');
  if (!auth.ok) return auth.response;
  if (!isLive(env)) {
    return Response.json({ error: 'Live outbound is locked.', code: 'LIVE_NOT_READY' }, { status: 503 });
  }
  if (!instagramOutboundConfigured(env)) {
    return Response.json({ error: 'Instagram outbound provider is not configured.', code: 'OUTBOUND_NOT_READY' }, { status: 503 });
  }

  const body = await request.json().catch(() => undefined) as {
    conversationId?: unknown;
    message?: unknown;
    idempotencyKey?: unknown;
  } | undefined;
  if (
    !body
    || typeof body.conversationId !== 'string'
    || typeof body.message !== 'string'
    || typeof body.idempotencyKey !== 'string'
  ) {
    return Response.json({
      error: 'conversationId, message and idempotencyKey are required.',
      code: 'INVALID_REQUEST',
    }, { status: 400 });
  }

  try {
    const outbox = await enqueueOutbound(env.DB, {
      workspaceId: auth.principal.workspaceId,
      conversationId: body.conversationId,
      idempotencyKey: body.idempotencyKey,
      body: body.message,
      actorId: auth.principal.subject,
    });

    let dispatchDeferred = false;
    if (outbox.status === 'pending') {
      try {
        await env.EVENTS_QUEUE.send({
          kind: 'outbound_delivery',
          id: outbox.id,
          workspaceId: outbox.workspaceId,
        } satisfies OutboundDeliveryEnvelope, { contentType: 'json' });
      } catch {
        dispatchDeferred = true;
        console.warn(JSON.stringify({
          event: 'outbound_queue_deferred',
          workspaceId: outbox.workspaceId,
          outboxId: outbox.id,
        }));
      }
    }

    await writeAuditLog(env.DB, auth.principal, outbox.replayed ? 'message.outbound_replayed' : 'message.outbound_enqueued', 'outbound_message', outbox.id, {
      conversationId: outbox.conversationId,
      platform: outbox.platform,
      replayed: outbox.replayed,
      dispatchDeferred,
    });

    return Response.json({
      id: outbox.id,
      status: outbox.status,
      replayed: outbox.replayed,
      dispatchDeferred,
    }, { status: outbox.status === 'sent' ? 200 : 202 });
  } catch (error) {
    if (error instanceof OutboxError) {
      if (error.code === 'INVALID_REQUEST') {
        return Response.json({ error: error.message, code: error.code }, { status: 400 });
      }
      if (error.code === 'CONVERSATION_NOT_FOUND') {
        return Response.json({ error: error.message, code: error.code }, { status: 404 });
      }
      return Response.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }
}

function oauthErrorResponse(error: InstagramOAuthError): Response {
  if (error.code === 'OAUTH_NOT_CONFIGURED') {
    return Response.json({ error: error.message, code: error.code }, { status: 503 });
  }
  if (error.code === 'CONNECTION_NOT_FOUND') {
    return Response.json({ error: error.message, code: error.code }, { status: 404 });
  }
  if (error.code === 'INVALID_OAUTH_STATE' || error.code === 'OAUTH_STATE_EXPIRED') {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  return Response.json({ error: error.message, code: error.code }, { status: 502 });
}

async function handleInstagramOAuthStart(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateMutation(request, env, '/api/oauth/instagram/start');
  if (!auth.ok) return auth.response;
  if (auth.principal.role !== 'admin' && auth.principal.role !== 'manager') {
    return Response.json({ error: 'Only workspace administrators or managers can connect social accounts.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
  }
  if (env.DEMO_MODE === 'true') {
    return Response.json({ error: 'Instagram OAuth is disabled in demo mode.', code: 'LIVE_NOT_READY' }, { status: 503 });
  }

  const body = await request.json().catch(() => undefined) as { connectionId?: unknown } | undefined;
  const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : undefined;
  try {
    return Response.json(await startInstagramOAuth(env.DB, env, auth.principal, connectionId), { status: 201 });
  } catch (error) {
    if (error instanceof InstagramOAuthError) return oauthErrorResponse(error);
    throw error;
  }
}

function oauthRedirect(env: Env, outcome: 'connected' | 'error'): string {
  const configured = Reflect.get(env, 'INSTAGRAM_REDIRECT_URI');
  try {
    const base = new URL(typeof configured === 'string' ? configured : 'https://social-conversion.neptunebusiness.com/');
    base.pathname = '/';
    base.search = `?oauth=instagram-${outcome}`;
    base.hash = '';
    return base.toString();
  } catch {
    return `https://social-conversion.neptunebusiness.com/?oauth=instagram-${outcome}`;
  }
}

async function handleInstagramOAuthCallback(url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (url.searchParams.has('error') || !state || !code) {
    return Response.redirect(oauthRedirect(env, 'error'), 302);
  }
  try {
    await completeInstagramOAuth(env.DB, env, { state, code });
    return new Response(null, {
      status: 302,
      headers: {
        location: oauthRedirect(env, 'connected'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'instagram_oauth_callback_failed',
      code: error instanceof InstagramOAuthError ? error.code : 'unknown',
    }));
    return new Response(null, {
      status: 302,
      headers: {
        location: oauthRedirect(env, 'error'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  }
}

async function dispatchPending(env: Env): Promise<number> {
  if (!isLive(env) || !instagramOutboundConfigured(env)) return 0;
  const pending = await listDispatchableOutbound(env.DB, 50);
  if (pending.length === 0) return 0;
  await env.EVENTS_QUEUE.sendBatch(pending.map((item) => ({
    body: {
      kind: 'outbound_delivery',
      id: item.id,
      workspaceId: item.workspaceId,
    } satisfies OutboundDeliveryEnvelope,
    contentType: 'json' as const,
  })));
  console.log(JSON.stringify({ event: 'outbound_dispatch_sweep', count: pending.length }));
  return pending.length;
}

const productionWorker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/messages' && request.method === 'POST') {
      return handleOutboundApi(request, env);
    }
    if (url.pathname === '/api/oauth/instagram/start' && request.method === 'POST') {
      return handleInstagramOAuthStart(request, env);
    }
    if (url.pathname === '/oauth/instagram/callback' && request.method === 'GET') {
      return handleInstagramOAuthCallback(url, env);
    }

    const response = await baseWorker.fetch(request, env, ctx);
    if (url.pathname === '/api/runtime' && request.method === 'GET' && response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = await response.json() as Record<string, unknown>;
        return Response.json({
          ...payload,
          outboundReady: isLive(env) && instagramOutboundConfigured(env),
          instagramOAuthReady: env.DEMO_MODE !== 'true' && instagramOAuthConfigured(env),
        }, {
          status: response.status,
          headers: response.headers,
        });
      }
    }
    return response;
  },

  async queue(batch: MessageBatch<ProductionQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      if (isOutboundEnvelope(message.body)) {
        try {
          const claimed = await claimOutboundForDelivery(env.DB, message.body.id, message.body.workspaceId);
          if (!claimed) {
            message.ack();
            continue;
          }
          const result = await deliverInstagramOutbound(env.DB, env, message.body);
          console.log(JSON.stringify({
            event: 'outbound_delivery_processed',
            workspaceId: message.body.workspaceId,
            outboxId: message.body.id,
            result,
          }));
          message.ack();
        } catch (error) {
          console.error(JSON.stringify({
            event: 'outbound_delivery_worker_failed',
            workspaceId: message.body.workspaceId,
            outboxId: message.body.id,
            message: error instanceof Error ? error.message : 'unknown',
          }));
          // A row may already be in `sending`. Automatic replay after an unknown crash could duplicate a Meta message.
          // Leave it for operational review instead of blindly retrying the provider call.
          message.ack();
        }
        continue;
      }

      try {
        const result = await persistSocialEvent(env.DB, message.body);
        console.log(JSON.stringify({ event: 'social_event_processed', id: message.body.id, result }));
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: 'social_event_failed',
          id: message.body.id,
          message: error instanceof Error ? error.message : 'unknown',
        }));
        message.retry({ delaySeconds: 30 });
      }
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const refresh = await refreshExpiringInstagramTokens(env.DB, env);
      if (refresh.refreshed > 0 || refresh.failed > 0) {
        console.log(JSON.stringify({ event: 'instagram_oauth_refresh_sweep', ...refresh }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: 'instagram_oauth_refresh_sweep_failed',
        message: error instanceof Error ? error.message : 'unknown',
      }));
    }

    try {
      await dispatchPending(env);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'outbound_dispatch_sweep_failed',
        message: error instanceof Error ? error.message : 'unknown',
      }));
    }
  },
} satisfies ExportedHandler<Env, ProductionQueueMessage>;

export default productionWorker;
