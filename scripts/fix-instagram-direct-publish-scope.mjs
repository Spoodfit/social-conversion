import fs from 'node:fs';

const path = 'src/worker/instagram-oauth.ts';
let source = fs.readFileSync(path, 'utf8');

const before = `const instagramScopes = [\n  'instagram_business_basic',\n  'instagram_business_manage_messages',\n  'instagram_business_manage_comments',\n] as const;`;

const after = `const instagramScopes = [\n  'instagram_business_basic',\n  'instagram_business_content_publish',\n  'instagram_business_manage_messages',\n  'instagram_business_manage_comments',\n] as const;`;

if (source.includes(after)) {
  console.log('Instagram direct publishing scope already present.');
  process.exit(0);
}

if (!source.includes(before)) {
  throw new Error('Instagram publishing scope patch failed: scope anchor not found.');
}

source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log('Instagram direct OAuth now requests content publishing permission.');
