import fs from 'node:fs';

const path = 'src/worker/production.ts';
let source = fs.readFileSync(path, 'utf8');

function ensureMetaImports() {
  const importPattern = /import \{([\s\S]*?)\} from '\.\/meta-oauth';/;
  const match = source.match(importPattern);
  if (!match) throw new Error('Meta selection route guard failed: meta-oauth import block not found.');

  const required = ['completeMetaSelection', 'getMetaSelection'];
  const missing = required.filter((name) => !match[1].includes(name));
  if (!missing.length) return;

  const additions = missing.map((name) => `  ${name},`).join('\n');
  const replacement = match[0].replace('import {\n', `import {\n${additions}\n`);
  source = source.replace(match[0], replacement);
}

function ensureSelectionHandler() {
  if (source.includes('async function handleMetaSelection(')) return;
  const anchor = 'async function dispatchPending(env: Env): Promise<number> {';
  if (!source.includes(anchor)) {
    throw new Error('Meta selection route guard failed: dispatch anchor not found.');
  }

  const handler = `async function handleMetaSelection(request: Request, env: Env, selectionId: string): Promise<Response> {\n  const auth = await authenticateMutation(request, env, '/api/oauth/meta/selection');\n  if (!auth.ok) return auth.response;\n  if (auth.principal.role !== 'admin' && auth.principal.role !== 'manager') {\n    return Response.json({ error: 'Only workspace administrators or managers can connect social accounts.', code: 'ROLE_FORBIDDEN' }, { status: 403 });\n  }\n  try {\n    if (request.method === 'GET') {\n      return Response.json(await getMetaSelection(env.DB, env, auth.principal, selectionId));\n    }\n    const body = await request.json().catch(() => undefined) as { assetKeys?: unknown } | undefined;\n    const assetKeys = Array.isArray(body?.assetKeys)\n      ? body.assetKeys.filter((key): key is string => typeof key === 'string')\n      : [];\n    return Response.json(await completeMetaSelection(env.DB, env, auth.principal, selectionId, assetKeys));\n  } catch (error) {\n    if (error instanceof MetaOAuthError) return metaOauthErrorResponse(error);\n    console.error(JSON.stringify({ event: 'meta_selection_failed', message: error instanceof Error ? error.message : 'unknown' }));\n    return Response.json({ error: 'La sélection Meta n’a pas pu être enregistrée.', code: 'META_SELECTION_FAILED' }, { status: 503 });\n  }\n}\n\n`;

  source = source.replace(anchor, handler + anchor);
}

function ensureSelectionRoute() {
  const unsafeRoute = `    const metaSelection = url.pathname.match(/^\\/api\\/oauth\\/meta\\/selection\\/([0-9a-f-]{36})$/i);\n    if (metaSelection && (request.method === 'GET' || request.method === 'POST')) {\n      return handleMetaSelection(request, env, metaSelection[1]);\n    }`;
  const safeRoute = `    const metaSelection = url.pathname.match(/^\\/api\\/oauth\\/meta\\/selection\\/([0-9a-f-]{36})$/i);\n    const metaSelectionId = metaSelection?.[1];\n    if (metaSelectionId && (request.method === 'GET' || request.method === 'POST')) {\n      return handleMetaSelection(request, env, metaSelectionId);\n    }`;

  if (source.includes(unsafeRoute)) {
    source = source.replace(unsafeRoute, safeRoute);
  }
  if (source.includes('const metaSelectionId = metaSelection?.[1];')) return;

  const anchor = `    const socialStart = url.pathname.match(/^\\/api\\/oauth\\/(youtube|tiktok)\\/start$/);`;
  if (!source.includes(anchor)) {
    throw new Error('Meta selection route guard failed: social OAuth dispatch anchor not found.');
  }

  source = source.replace(anchor, safeRoute + '\n' + anchor);
}

ensureMetaImports();
ensureSelectionHandler();
ensureSelectionRoute();

const requiredFragments = [
  'async function handleMetaSelection(',
  'const metaSelectionId = metaSelection?.[1];',
  'getMetaSelection(env.DB, env, auth.principal, selectionId)',
  'completeMetaSelection(env.DB, env, auth.principal, selectionId, assetKeys)',
];
for (const fragment of requiredFragments) {
  if (!source.includes(fragment)) {
    throw new Error(`Meta selection route guard failed after patch: missing ${fragment}`);
  }
}

if (!source.includes('// META_SELECTION_ROUTE_GUARD_V1')) {
  source += '\n// META_SELECTION_ROUTE_GUARD_V1\n';
}
fs.writeFileSync(path, source);
console.log('Meta selection API route verified.');
