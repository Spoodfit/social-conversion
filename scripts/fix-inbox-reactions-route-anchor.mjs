import fs from 'node:fs';

const path = 'scripts/apply-inbox-reactions.mjs';
let source = fs.readFileSync(path, 'utf8');

const oldBlock = `  cockpit = replaceOnce(\n    cockpit,\n    \`    const url = new URL(request.url);\\n    if (url.pathname === '/api/publications' || url.pathname.startsWith('/api/publications/')) {\`,\n    \`    const url = new URL(request.url);\\n    if (url.pathname === '/api/inbox/reactions') {\\n      return handleInboxReactionApi(request, env, url);\\n    }\\n    if (url.pathname === '/api/publications' || url.pathname.startsWith('/api/publications/')) {\`,\n    'reaction route',\n  );`;

const newBlock = `  const fetchAnchor = \`  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {\\n    const url = new URL(request.url);\`;\n  if (!cockpit.includes(fetchAnchor)) throw new Error('Inbox reactions patch failed: cockpit fetch anchor not found.');\n  cockpit = cockpit.replace(fetchAnchor, \`\${fetchAnchor}\\n    if (url.pathname === '/api/inbox/reactions') {\\n      return handleInboxReactionApi(request, env, url);\\n    }\`);`;

if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, newBlock);
  fs.writeFileSync(path, source);
  console.log('Inbox reactions cockpit route anchor normalized.');
} else if (source.includes("const fetchAnchor = `  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>")) {
  console.log('Inbox reactions cockpit route anchor already normalized.');
} else {
  throw new Error('Inbox reactions route fixer could not locate the original route block.');
}
