import fs from 'node:fs';

const path = 'src/worker/inbox-reactions.ts';
let source = fs.readFileSync(path, 'utf8');
source = source.replace(
  '): Promise<FacebookConnection | undefined> {',
  '): Promise<FacebookConnection | null | undefined> {',
);
source = source.replace(
  '): Promise<LinkedInConnection | undefined> {',
  '): Promise<LinkedInConnection | null | undefined> {',
);
fs.writeFileSync(path, source);
console.log('Inbox reaction D1 nullable connection types normalized.');
