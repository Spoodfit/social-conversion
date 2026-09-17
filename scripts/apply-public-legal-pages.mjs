import fs from 'node:fs';

const path = 'src/worker/cockpit-production.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('PUBLIC_LEGAL_PAGES_V1')) {
  console.log('Public legal pages already applied.');
  process.exit(0);
}

const importAnchor = "import productionWorker from './production';";
if (!source.includes(importAnchor)) throw new Error('Public legal pages patch failed: production import not found.');
source = source.replace(
  importAnchor,
  `${importAnchor}\nimport { publicLegalResponse } from './public-legal';`,
);

const fetchAnchor = `  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {\n    const url = new URL(request.url);`;
if (!source.includes(fetchAnchor)) throw new Error('Public legal pages patch failed: fetch anchor not found.');
source = source.replace(
  fetchAnchor,
  `${fetchAnchor}\n    const legalResponse = publicLegalResponse(url.pathname, request.method);\n    if (legalResponse) return legalResponse;`,
);

source += '\n// PUBLIC_LEGAL_PAGES_V1\n';
fs.writeFileSync(path, source);
console.log('Public privacy and data deletion routes applied.');
