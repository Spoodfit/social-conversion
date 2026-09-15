import fs from 'node:fs';

const path = 'src/worker/facebook-runtime-sync.ts';
let source = fs.readFileSync(path, 'utf8');
source = source.replace(
  'const payload = await graphGet<GraphPage<FacebookPost>>(fetchImpl, next, token);',
  'const payload: GraphPage<FacebookPost> = await graphGet<GraphPage<FacebookPost>>(fetchImpl, next, token);',
);
source = source.replace(
  'const payload = await graphGet<GraphPage<FacebookMessage>>(fetchImpl, next, token);',
  'const payload: GraphPage<FacebookMessage> = await graphGet<GraphPage<FacebookMessage>>(fetchImpl, next, token);',
);
if (!source.includes('const payload: GraphPage<FacebookPost>') || !source.includes('const payload: GraphPage<FacebookMessage>')) {
  throw new Error('Facebook runtime type stabilization failed.');
}
fs.writeFileSync(path, source);
console.log('Facebook Graph paging types stabilized.');
