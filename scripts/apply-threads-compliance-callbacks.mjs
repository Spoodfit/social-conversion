import fs from 'node:fs';

const path = 'src/worker/production.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('THREADS_COMPLIANCE_CALLBACKS_V1')) {
  console.log('Threads compliance callbacks already applied.');
  process.exit(0);
}

const dispatchAnchor = 'async function dispatchPending(env: Env): Promise<number> {';
if (!source.includes(dispatchAnchor)) throw new Error('Threads compliance callbacks patch failed: dispatch anchor not found.');

const complianceCode = String.raw`
function threadsDecodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = atob(padded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function threadsSignedRequestUserId(request: Request, env: Env): Promise<string | undefined> {
  const appSecret = Reflect.get(env, 'THREADS_APP_SECRET');
  if (typeof appSecret !== 'string' || !appSecret.trim()) return undefined;

  const form = await request.formData().catch(() => undefined);
  const raw = form?.get('signed_request');
  if (typeof raw !== 'string' || raw.length > 16_384) return undefined;
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(appSecret.trim()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      threadsDecodeBase64Url(parts[0]),
      new TextEncoder().encode(parts[1]),
    );
    if (!valid) return undefined;

    const payloadText = new TextDecoder().decode(threadsDecodeBase64Url(parts[1]));
    const payload = JSON.parse(payloadText) as { user_id?: unknown; algorithm?: unknown };
    if (typeof payload.algorithm === 'string' && payload.algorithm.toUpperCase() !== 'HMAC-SHA256') return undefined;
    const userId = typeof payload.user_id === 'string' || typeof payload.user_id === 'number'
      ? String(payload.user_id)
      : '';
    return /^\d{3,40}$/.test(userId) ? userId : undefined;
  } catch {
    return undefined;
  }
}

async function handleThreadsDeauthorize(request: Request, env: Env): Promise<Response> {
  const userId = await threadsSignedRequestUserId(request, env);
  if (!userId) return Response.json({ error: 'Invalid signed request.' }, { status: 400 });

  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE threads_connections SET status = 'disconnected', updated_at = ? WHERE external_account_id = ?",
  ).bind(now, userId).run();

  console.log(JSON.stringify({ event: 'threads_deauthorized', accountId: userId }));
  return Response.json({ success: true }, { headers: { 'cache-control': 'no-store' } });
}

async function handleThreadsDataDeletion(request: Request, env: Env): Promise<Response> {
  const userId = await threadsSignedRequestUserId(request, env);
  if (!userId) return Response.json({ error: 'Invalid signed request.' }, { status: 400 });

  const now = new Date().toISOString();
  const confirmation = 'thdel_' + crypto.randomUUID().replace(/-/g, '');
  const connections = await env.DB.prepare(
    "SELECT id, workspace_id FROM threads_connections WHERE external_account_id = ?",
  ).bind(userId).all<{ id: string; workspace_id: string }>();

  for (const connection of connections.results) {
    await env.DB.prepare(
      "INSERT INTO privacy_requests " +
      "(id, workspace_id, contact_id, request_type, status, requested_by, requested_at, completed_at, result_reference, notes) " +
      "VALUES (?, ?, NULL, 'delete', 'completed', 'threads_data_deletion', ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      connection.workspace_id,
      now,
      now,
      confirmation,
      'Threads data deletion callback for connection ' + connection.id,
    ).run();
  }

  await env.DB.prepare(
    "DELETE FROM threads_connections WHERE external_account_id = ?",
  ).bind(userId).run();

  console.log(JSON.stringify({ event: 'threads_data_deleted', confirmationCode: confirmation }));
  return Response.json({
    url: 'https://social.neptunebusiness.com/data-deletion?confirmation=' + encodeURIComponent(confirmation),
    confirmation_code: confirmation,
  }, { headers: { 'cache-control': 'no-store' } });
}

`;

source = source.replace(dispatchAnchor, complianceCode + dispatchAnchor);

const callbackAnchor = `    if (url.pathname === '/oauth/threads/callback' && request.method === 'GET') {\n      return handleThreadsOAuthCallback(url, env);\n    }`;
if (!source.includes(callbackAnchor)) throw new Error('Threads compliance callbacks patch failed: Threads callback route anchor not found.');
source = source.replace(
  callbackAnchor,
  `${callbackAnchor}\n    if (url.pathname === '/oauth/threads/deauthorize' && request.method === 'POST') {\n      return handleThreadsDeauthorize(request, env);\n    }\n    if (url.pathname === '/oauth/threads/data-deletion' && request.method === 'POST') {\n      return handleThreadsDataDeletion(request, env);\n    }`,
);

source += '\n// THREADS_COMPLIANCE_CALLBACKS_V1\n';
fs.writeFileSync(path, source);
console.log('Threads deauthorization and data deletion callbacks applied.');
