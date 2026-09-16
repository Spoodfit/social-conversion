import fs from 'node:fs';

const path = 'src/worker/linkedin-publishing.ts';
let source = fs.readFileSync(path, 'utf8');

if (!source.includes('SC_LINKEDIN_POSTS_API_EXTERNAL_URL_V1')) {
  const anchor = `    const syncedAt = new Date().toISOString();`;
  if (!source.includes(anchor)) throw new Error('LinkedIn Posts API fix failed: syncedAt anchor missing.');
  const externalUrlLine = `    const externalUrl = externalId.startsWith('urn:li:') ? \`https://www.linkedin.com/feed/update/\${externalId}/\` : undefined;\n`;
  const before = source.slice(0, source.indexOf(anchor));
  if (!before.includes('const externalUrl =')) {
    source = source.replace(anchor, externalUrlLine + anchor);
  }
  source += '\n// SC_LINKEDIN_POSTS_API_EXTERNAL_URL_V1\n';
  fs.writeFileSync(path, source);
}

console.log('LinkedIn Posts API external URL tracking restored.');
