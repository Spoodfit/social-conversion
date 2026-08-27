import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { demoData } from '../shared/demo-data';
import { extractMetaExternalAccountIds, normalizeMetaWebhook } from '../shared/events';
import type { NormalizedSocialEvent, SocialConnectionIdentity } from '../shared/types';
import { getAccessConfig, verifyAccessToken, type AccessIdentity, type AccessTokenVerifier } from './auth';
import {
  listWorkspaceMemberships,
  resolveWorkspaceMembership,
  roleCanMutate,
  writeAuditLog,
  type WorkspacePrincipal,
} from './authorization';
import { persistSocialEvent } from './persistence';
import {
  optionalSecret,
  readTextWithinLimit,
  verifyMetaSignature,
  verifySecret,
} from './security';

type AppBindings = {
  Bindings: Env;
  Variables: {
    identity: AccessIdentity;
    principal: WorkspacePrincipal;
  };
};

interface AppDependencies {
  verifyAccessToken: AccessTokenVerifier;
}

interface SocialConnectionRow {
  id: string;
  workspace_id: string;
  external_account_id: string;
}

interface LiveConnectionRow {
  id: string;
  platform: 'instagram' | 'youtube' | 'tiktok';
  display_name: string;
  handle: string | null;
  status: string;
  last_synced_at: string | null;
}

interface LiveConversationRow {
  id: string;
  contact_name: string;
  handle: string | null;
  platform: 'instagram' | 'youtube' | 'tiktok';
  status: string;
  priority: string;
  lead_stage: string;
  estimated_value_cents: number;
  last_message_at: string | null;
}

function isDemoMode(env: Env): boolean {
  return env.DEMO_MODE === 'true';
}

function liveRuntimeReady(env: Env): boolean {
  return String(env.LIVE_READY) === 'true';
}

async function loadMetaConnections(
  db: D1Database,
  externalAccountIds: string[],
): Promise<Map<string, SocialConnectionIdentity>> {
  if (externalAccountIds.length === 0) return new Map();
  const placeholders = externalAccountIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT id, workspace_id, external_account_id
       FROM social_connections
       WHERE platform = 'instagram'
         AND status = 'connected'
         AND external_account_id IN (${placeholders})`,
    )
    .bind(...externalAccountIds)
    .all<SocialConnectionRow>();

  return new Map(result.results.map((row) => [
    row.external_account_id,
    { id: row.id, workspaceId: row.workspace_id },
  ]));
}

async function loadLiveBootstrap(db: D1Database, principal: WorkspacePrincipal) {
  const [connectionsResult, contactsResult, conversationsResult, pipelineResult, recentResult] = await db.batch([
    db.prepare(
      `SELECT id, platform, display_name, handle, status, last_synced_at
       FROM social_connections
       WHERE workspace_id = ?
       ORDER BY platform, display_name`,
    ).bind(principal.workspaceId),
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM contacts
       WHERE workspace_id = ?`,
    ).bind(principal.workspaceId),
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM conversations
       WHERE workspace_id = ? AND status = 'open'`,
    ).bind(principal.workspaceId),
    db.prepare(
      `SELECT COALESCE(SUM(estimated_value_cents), 0) AS total
       FROM conversations
       WHERE workspace_id = ? AND lead_stage <> 'Gagné'`,
    ).bind(principal.workspaceId),
    db.prepare(
      `SELECT
         c.id,
         ct.display_name AS contact_name,
         ct.handle,
         ct.platform,
         c.status,
         c.priority,
         c.lead_stage,
         c.estimated_value_cents,
         c.last_message_at
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.workspace_id = ?
       ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
       LIMIT 20`,
    ).bind(principal.workspaceId),
  ]);

  const connections = connectionsResult.results as unknown as LiveConnectionRow[];
  const recentConversations = recentResult.results as unknown as LiveConversationRow[];
  const contacts = Number((contactsResult.results[0] as { count?: number } | undefined)?.count ?? 0);
  const openConversations = Number((conversationsResult.results[0] as { count?: number } | undefined)?.count ?? 0);
  const estimatedPipelineCents = Number((pipelineResult.results[0] as { total?: number } | undefined)?.total ?? 0);

  return {
    workspace: {
      id: principal.workspaceId,
      name: principal.workspaceName,
      role: principal.role,
    },
    metrics: {
      contacts,
      openConversations,
      connectedAccounts: connections.filter((connection) => connection.status === 'connected').length,
      estimatedPipelineCents,
    },
    connections: connections.map((connection) => ({
      id: connection.id,
      platform: connection.platform,
      displayName: connection.display_name,
      handle: connection.handle ?? undefined,
      status: connection.status,
      lastSyncedAt: connection.last_synced_at ?? undefined,
    })),
    recentConversations: recentConversations.map((conversation) => ({
      id: conversation.id,
      contactName: conversation.contact_name,
      handle: conversation.handle ?? undefined,
      platform: conversation.platform,
      status: conversation.status,
      priority: conversation.priority,
      leadStage: conversation.lead_stage,
      estimatedValueCents: conversation.estimated_value_cents,
      lastMessageAt: conversation.last_message_at ?? undefined,
    })),
  };
}

export function createApp(
  dependencies: AppDependencies = { verifyAccessToken },
): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use('*', secureHeaders({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  }));

  app.get('/health', (c) => c.json({
    status: 'ok',
    service: 'neptune-social-conversion',
    time: new Date().toISOString(),
  }));

  app.use('/api/*', async (c, next) => {
    const accessConfig = getAccessConfig(c.env);
    if (!accessConfig) {
      return c.json({
        error: 'Cloudflare Access is not configured.',
        code: 'ACCESS_NOT_CONFIGURED',
      }, 503);
    }

    const token = c.req.header('cf-access-jwt-assertion');
    if (!token) {
      return c.json({ error: 'Authentication required.', code: 'ACCESS_TOKEN_MISSING' }, 401);
    }

    let identity: AccessIdentity;
    try {
      identity = await dependencies.verifyAccessToken(token, accessConfig);
    } catch {
      console.warn(JSON.stringify({ event: 'access_token_rejected', path: c.req.path }));
      return c.json({ error: 'Authentication failed.', code: 'ACCESS_TOKEN_INVALID' }, 401);
    }

    const rateLimit = await c.env.API_RATE_LIMITER.limit({
      key: `${identity.subject}:${c.req.method}:${c.req.path}`,
    });
    if (!rateLimit.success) {
      return c.json({ error: 'Too many requests.', code: 'RATE_LIMITED' }, 429);
    }

    c.set('identity', identity);
    await next();
  });

  app.get('/api/runtime', (c) => {
    const demo = isDemoMode(c.env);
    return c.json({
      mode: demo ? 'demo' : 'live',
      ready: demo || liveRuntimeReady(c.env),
      outboundReady: false,
      aiReady: false,
    });
  });

  app.get('/api/workspaces', async (c) => {
    const workspaces = await listWorkspaceMemberships(c.env.DB, c.get('identity'));
    return c.json({ workspaces });
  });

  app.use('/api/*', async (c, next) => {
    const identity = c.get('identity');
    const requestedWorkspaceId = c.req.header('x-workspace-id');
    const membership = await resolveWorkspaceMembership(c.env.DB, identity, requestedWorkspaceId);
    if (membership.status === 'workspace_required') {
      return c.json({
        error: 'Select a workspace with the X-Workspace-Id header.',
        code: 'WORKSPACE_REQUIRED',
      }, 400);
    }
    if (membership.status === 'forbidden') {
      return c.json({ error: 'Workspace access denied.', code: 'WORKSPACE_FORBIDDEN' }, 403);
    }

    c.set('principal', membership.principal);
    await next();
  });

  app.get('/api/health', (c) => c.json({
    status: 'ok',
    service: 'neptune-social-conversion',
    time: new Date().toISOString(),
  }));

  app.get('/api/session', (c) => {
    const principal = c.get('principal');
    return c.json({
      subject: principal.subject,
      email: principal.email,
      workspace: {
        id: principal.workspaceId,
        name: principal.workspaceName,
        role: principal.role,
      },
    });
  });

  app.get('/api/bootstrap', async (c) => {
    const principal = c.get('principal');
    if (isDemoMode(c.env)) {
      return c.json({
        ...demoData,
        workspace: {
          ...demoData.workspace,
          name: principal.workspaceName,
          mode: 'demo' as const,
        },
      });
    }
    if (!liveRuntimeReady(c.env)) {
      return c.json({
        error: 'Live runtime is locked until production data sources and connectors are validated.',
        code: 'LIVE_NOT_READY',
      }, 503);
    }

    return c.json(await loadLiveBootstrap(c.env.DB, principal));
  });

  app.post('/api/messages', async (c) => {
    const principal = c.get('principal');
    if (!roleCanMutate(principal.role)) {
      return c.json({ error: 'Mutation forbidden for this role.', code: 'ROLE_FORBIDDEN' }, 403);
    }

    const body = await c.req
      .json<{ conversationId?: string; message?: string }>()
      .catch((): { conversationId?: string; message?: string } => ({}));
    const message = body.message?.trim();
    if (!body.conversationId || !message || message.length > 2_000) {
      return c.json({ error: 'conversationId et message (2 000 caractères maximum) sont requis.' }, 400);
    }

    const sentAt = new Date().toISOString();
    const id = crypto.randomUUID();
    if (isDemoMode(c.env)) {
      await writeAuditLog(c.env.DB, principal, 'message.simulated', 'conversation', body.conversationId, {
        messageLength: message.length,
      });
      return c.json({ id, status: 'simulated', sentAt }, 202);
    }

    return c.json({
      error: 'Outbound social connector is not configured.',
      code: 'OUTBOUND_NOT_READY',
    }, 503);
  });

  app.post('/api/ai/suggest', async (c) => {
    const principal = c.get('principal');
    if (!roleCanMutate(principal.role)) {
      return c.json({ error: 'Mutation forbidden for this role.', code: 'ROLE_FORBIDDEN' }, 403);
    }

    const body = await c.req
      .json<{ intent?: string; name?: string }>()
      .catch((): { intent?: string; name?: string } => ({}));

    if (!isDemoMode(c.env)) {
      return c.json({
        error: 'AI provider is not configured for live use.',
        code: 'AI_NOT_READY',
      }, 503);
    }

    const firstName = body.name?.trim().split(/\s+/)[0] || 'vous';
    const suggestion = `Avec plaisir ${firstName}. Pour vous orienter vers le bon format, préférez-vous rencontrer de futurs clients ou des partenaires ?`;
    await writeAuditLog(c.env.DB, principal, 'ai.demo_suggestion', 'conversation', undefined, {
      hasIntent: Boolean(body.intent?.trim()),
    });
    return c.json({ suggestion, mode: 'draft', generatedBy: 'demo-policy' });
  });

  app.get('/webhooks/meta', async (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');
    const expected = optionalSecret(c.env, 'META_VERIFY_TOKEN');
    const valid = expected ? await verifySecret(token, expected) : false;
    if (mode === 'subscribe' && valid && challenge) return c.text(challenge);
    return c.text('Verification failed', 403);
  });

  app.post('/webhooks/meta', async (c) => {
    const bodyResult = await readTextWithinLimit(c.req.raw, 1_000_000);
    if (!bodyResult.ok) {
      return c.json(
        { error: bodyResult.reason === 'too_large' ? 'Payload too large' : 'Invalid UTF-8' },
        bodyResult.reason === 'too_large' ? 413 : 400,
      );
    }
    const body = bodyResult.text;
    const secret = optionalSecret(c.env, 'META_APP_SECRET');
    if (!secret) return c.json({ error: 'Meta webhook is not configured' }, 503);

    const valid = await verifyMetaSignature(body, c.req.header('x-hub-signature-256'), secret);
    if (!valid) return c.json({ error: 'Invalid signature' }, 401);

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const externalAccountIds = extractMetaExternalAccountIds(payload);
    const connections = await loadMetaConnections(c.env.DB, externalAccountIds);
    const events = normalizeMetaWebhook(payload, connections).slice(0, 100);
    if (events.length > 0) {
      await c.env.EVENTS_QUEUE.sendBatch(events.map((event) => ({
        body: event,
        contentType: 'json' as const,
      })));
    }
    console.log(JSON.stringify({
      event: 'meta_webhook_accepted',
      count: events.length,
      mappedAccounts: connections.size,
      unmappedAccounts: Math.max(0, externalAccountIds.length - connections.size),
    }));
    return c.json({ accepted: events.length }, 202);
  });

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((error, c) => {
    console.error(JSON.stringify({ event: 'request_error', message: error.message, path: c.req.path }));
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}

const app = createApp();

const worker = {
  fetch: app.fetch,
  async queue(batch: MessageBatch<NormalizedSocialEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const result = await persistSocialEvent(env.DB, message.body);
        console.log(JSON.stringify({ event: 'social_event_processed', id: message.body.id, result }));
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ event: 'social_event_failed', id: message.body.id, message: error instanceof Error ? error.message : 'unknown' }));
        message.retry({ delaySeconds: 30 });
      }
    }
  },
} satisfies ExportedHandler<Env, NormalizedSocialEvent>;

export default worker;
