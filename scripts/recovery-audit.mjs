import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const worker = readFileSync(join(root, 'src/worker/index.ts'), 'utf8');
const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
const failures = [];

for (const required of ['LIVE_NOT_READY', 'OUTBOUND_NOT_READY', 'AI_NOT_READY']) {
  if (!worker.includes(required)) failures.push(`missing fail-closed marker: ${required}`);
}

if (worker.includes("status: 'queued'")) {
  failures.push('worker must not report an outbound message as queued before a real connector exists');
}

if (!/"LIVE_READY"\s*:\s*"false"/.test(wrangler)) {
  failures.push('LIVE_READY must default to false');
}

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /EAA[A-Za-z0-9]{40,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
];
const scanRoots = ['src', 'docs', '.github'];

function walk(path) {
  for (const name of readdirSync(path)) {
    const absolute = join(path, name);
    if (statSync(absolute).isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!/\.(?:ts|tsx|js|mjs|json|jsonc|md|ya?ml)$/.test(name)) continue;
    const content = readFileSync(absolute, 'utf8');
    for (const pattern of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) failures.push(`possible secret in ${relative(root, absolute)}`);
    }
  }
}

for (const directory of scanRoots) walk(join(root, directory));

if (failures.length) {
  console.error('Recovery audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Recovery audit passed. Live mode remains fail-closed and no obvious secret pattern was detected.');
