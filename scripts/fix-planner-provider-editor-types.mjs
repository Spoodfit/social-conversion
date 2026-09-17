import fs from 'node:fs';

const path = 'src/worker/index.ts';
let source = fs.readFileSync(path, 'utf8');
const before = `    const payload = await c.req.json<{ body?: unknown }>().catch(() => ({}));`;
const after = `    const payload: { body?: unknown } = await c.req.json<{ body?: unknown }>().catch(() => ({ body: undefined }));`;
if (source.includes(before)) {
  source = source.replace(before, after);
  fs.writeFileSync(path, source);
  console.log('Provider editor request payload type fixed.');
} else if (source.includes(after)) {
  console.log('Provider editor request payload type already fixed.');
} else {
  throw new Error('Provider editor type-fix anchor not found.');
}
