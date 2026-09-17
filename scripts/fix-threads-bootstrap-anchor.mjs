import fs from 'node:fs';

const path = 'src/worker/index.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('SC_THREADS_BOOTSTRAP_V1')) {
  console.log('Threads bootstrap aggregation already applied.');
  process.exit(0);
}

// Extend whichever bootstrap connection union is currently generated. The production
// branch has accumulated Facebook/LinkedIn patches, so do not depend on one exact union.
source = source.replace(
  /platform: ([^;\n]*'linkedin'[^;\n]*);/,
  (match) => match.includes("'threads'") ? match : match.replace(';', " | 'threads';"),
);

const linkedInNeedle = "       FROM linkedin_connections\n       WHERE workspace_id = ?";
const linkedInPos = source.indexOf(linkedInNeedle);
if (linkedInPos < 0) {
  throw new Error('Threads bootstrap fix failed: LinkedIn bootstrap source not found.');
}

const prepareStart = source.lastIndexOf('    db.prepare(', linkedInPos);
let orderPos = source.indexOf('       ORDER BY platform, display_name`', linkedInPos);
if (prepareStart < 0 || orderPos < 0) {
  throw new Error('Threads bootstrap fix failed: account bootstrap query boundaries not found.');
}

const queryPrefix = source.slice(prepareStart, orderPos);
if (!queryPrefix.includes('FROM social_connections') || !queryPrefix.includes('FROM facebook_connections')) {
  throw new Error('Threads bootstrap fix failed: unexpected bootstrap query shape.');
}

if (!queryPrefix.includes('FROM threads_connections')) {
  const threadsUnion =
    "       UNION ALL\n" +
    "       SELECT id, 'threads' AS platform, display_name, handle, status, last_synced_at\n" +
    "       FROM threads_connections\n" +
    "       WHERE workspace_id = ?\n";
  source = source.slice(0, orderPos) + threadsUnion + source.slice(orderPos);
}

// Recompute offsets after inserting the UNION and add the matching D1 bind value.
orderPos = source.indexOf('       ORDER BY platform, display_name`', linkedInPos);
const bindStart = source.indexOf('    ).bind(', orderPos);
if (bindStart < 0) throw new Error('Threads bootstrap fix failed: bootstrap bind not found.');
const argsStart = bindStart + '    ).bind('.length;
const argsEnd = source.indexOf('),', argsStart);
if (argsEnd < 0) throw new Error('Threads bootstrap fix failed: bootstrap bind terminator not found.');
const args = source.slice(argsStart, argsEnd);
if (!args.trim()) throw new Error('Threads bootstrap fix failed: bootstrap bind arguments are empty.');
source = source.slice(0, argsEnd) + ', principal.workspaceId' + source.slice(argsEnd);

source += '\n// SC_THREADS_BOOTSTRAP_V1\n';
fs.writeFileSync(path, source);
console.log('Threads bootstrap aggregation applied to the current production query.');
