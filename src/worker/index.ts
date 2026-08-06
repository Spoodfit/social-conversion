import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { demoData } from '../shared/demo-data';
import { normalizeMetaWebhook } from '../shared/events';
import type { NormalizedSocialEvent } from '../shared/types';
import { persistSocialEvent } from './persistence';
import { optionalSecret, verifyMetaSignature } from './security';

type AppBindings = { Bindings: Env };
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

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'neptune-social-conversion', time: new Date().toISOString() }));

app.get('/api/bootstrap', (c) => {
  const mode = c.env.DEMO_MODE === 'true' ? 'demo' : 'live';
  return c.json({ ...demoData, workspace: { ...demoData.workspace, mode } });
});

app.post('/api/messages', async (c) => {
  const body = await c.req
    .json<{ conversationId?: string; message?: string }>()
    .catch((): { conversationId?: string; message?: string } => ({}));
  const message = body.message?.trim();
  if (!body.conversationId || !message || message.length > 2_000) {
    return c.json({ error: 'conversationId et message (2 000 caractères maximum) sont requis.' }, 400);
  }

  const sentAt = new Date().toISOString();
  const id = crypto.randomUUID();
  if (c.env.DEMO_MODE !== 'true') {
    await c.env.DB
      .prepare(
        `INSERT INTO messages (id, conversation_id, direction, message_type, body, sent_at, created_at)
         VALUES (?, ?, 'outbound', 'message', ?, ?, ?)`,
      )
      .bind(id, body.conversationId, message, sentAt, sentAt)
      .run();
  }

  return c.json({ id, status: c.env.DEMO_MODE === 'true' ? 'simulated' : 'queued', sentAt }, 202);
});

app.post('/api/ai/suggest', async (c) => {
  const body = await c.req
    .json<{ intent?: string; name?: string }>()
    .catch((): { intent?: string; name?: string } => ({}));
  const firstName = body.name?.trim().split(/\s+/)[0] || 'vous';
  const suggestion = `Avec plaisir ${firstName}. Pour vous orienter vers le bon format, préférez-vous rencontrer de futurs clients ou des partenaires ?`;
  return c.json({ suggestion, mode: 'draft', generatedBy: 'demo-policy' });
});

app.get('/webhooks/meta', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');
  const expected = optionalSecret(c.env, 'META_VERIFY_TOKEN');
  if (mode === 'subscribe' && expected && token === expected && challenge) return c.text(challenge);
  return c.text('Verification failed', 403);
});

app.post('/webhooks/meta', async (c) => {
  const body = await c.req.text();
  if (body.length > 1_000_000) return c.json({ error: 'Payload too large' }, 413);
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

  const events = normalizeMetaWebhook(payload, c.req.query('connection') || 'meta-default');
  await Promise.all(events.map((event) => c.env.EVENTS_QUEUE.send(event, { contentType: 'json' })));
  console.log(JSON.stringify({ event: 'meta_webhook_accepted', count: events.length }));
  return c.json({ accepted: events.length }, 202);
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  console.error(JSON.stringify({ event: 'request_error', message: error.message }));
  return c.json({ error: 'Internal error' }, 500);
});

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
