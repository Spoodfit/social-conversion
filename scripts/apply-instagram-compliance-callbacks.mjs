import fs from 'node:fs';

const path = 'src/worker/production.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('INSTAGRAM_COMPLIANCE_CALLBACKS_V1')) {
  console.log('Instagram compliance callbacks already applied.');
  process.exit(0);
}

const dispatchAnchor = 'async function dispatchPending(env: Env): Promise<number> {';
if (!source.includes(dispatchAnchor)) throw new Error('Instagram compliance callbacks patch failed: dispatch anchor not found.');

const complianceCode = String.raw`
function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = atob(padded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

async function instagramSignedRequestUserId(request: Request, env: Env): Promise<string | undefined> {
  const appSecret = Reflect.get(env, 'INSTAGRAM_APP_SECRET');
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
      decodeBase64Url(parts[0]),
      new TextEncoder().encode(parts[1]),
    );
    if (!valid) return undefined;

    const payloadText = new TextDecoder().decode(decodeBase64Url(parts[1]));
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

async function handleInstagramDeauthorize(request: Request, env: Env): Promise<Response> {
  const userId = await instagramSignedRequestUserId(request, env);
  if (!userId) return Response.json({ error: 'Invalid signed request.' }, { status: 400 });

  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE oauth_credentials " +
    "SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? " +
    "WHERE provider = 'instagram' " +
    "AND connection_id IN (SELECT id FROM social_connections WHERE platform = 'instagram' AND external_account_id = ?)",
  ).bind(now, now, userId).run();
  await env.DB.prepare(
    "UPDATE social_connections SET status = 'disconnected', updated_at = ? " +
    "WHERE platform = 'instagram' AND external_account_id = ?",
  ).bind(now, userId).run();

  console.log(JSON.stringify({ event: 'instagram_deauthorized', accountId: userId }));
  return Response.json({ success: true }, { headers: { 'cache-control': 'no-store' } });
}

async function handleInstagramDataDeletion(request: Request, env: Env): Promise<Response> {
  const userId = await instagramSignedRequestUserId(request, env);
  if (!userId) return Response.json({ error: 'Invalid signed request.' }, { status: 400 });

  const now = new Date().toISOString();
  const confirmation = 'igdel_' + crypto.randomUUID().replace(/-/g, '');
  const connections = await env.DB.prepare(
    "SELECT id, workspace_id FROM social_connections " +
    "WHERE platform = 'instagram' AND external_account_id = ?",
  ).bind(userId).all<{ id: string; workspace_id: string }>();

  for (const connection of connections.results) {
    await env.DB.prepare(
      "INSERT INTO privacy_requests " +
      "(id, workspace_id, contact_id, request_type, status, requested_by, requested_at, completed_at, result_reference, notes) " +
      "VALUES (?, ?, NULL, 'delete', 'completed', 'instagram_data_deletion', ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      connection.workspace_id,
      now,
      now,
      confirmation,
      'Instagram data deletion callback for connection ' + connection.id,
    ).run();
  }

  await env.DB.prepare(
    "DELETE FROM oauth_credentials WHERE provider = 'instagram' " +
    "AND connection_id IN (SELECT id FROM social_connections WHERE platform = 'instagram' AND external_account_id = ?)",
  ).bind(userId).run();
  await env.DB.prepare(
    "UPDATE social_connections SET external_account_id = NULL, display_name = 'Instagram', handle = NULL, " +
    "status = 'disconnected', capabilities_json = '{}', last_synced_at = NULL, updated_at = ? " +
    "WHERE platform = 'instagram' AND external_account_id = ?",
  ).bind(now, userId).run();

  console.log(JSON.stringify({ event: 'instagram_data_deleted', confirmationCode: confirmation }));
  return Response.json({
    url: 'https://social.neptunebusiness.com/data-deletion?confirmation=' + encodeURIComponent(confirmation),
    confirmation_code: confirmation,
  }, { headers: { 'cache-control': 'no-store' } });
}

`;

source = source.replace(dispatchAnchor, complianceCode + dispatchAnchor);

const routeAnchor = `    if (url.pathname === '/oauth/instagram/callback' && request.method === 'GET') {\n      return handleInstagramOAuthCallback(url, env);\n    }`;
if (!source.includes(routeAnchor)) throw new Error('Instagram compliance callbacks patch failed: callback route anchor not found.');
source = source.replace(
  routeAnchor,
  `${routeAnchor}\n    if (url.pathname === '/oauth/instagram/deauthorize' && request.method === 'POST') {\n      return handleInstagramDeauthorize(request, env);\n    }\n    if (url.pathname === '/oauth/instagram/data-deletion' && request.method === 'POST') {\n      return handleInstagramDataDeletion(request, env);\n    }`,
);

source += '\n// INSTAGRAM_COMPLIANCE_CALLBACKS_V1\n';
fs.writeFileSync(path, source);
console.log('Instagram deauthorization and data deletion callbacks applied.');
