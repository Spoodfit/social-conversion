import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');
const typed = `  accountName?: string;\n  connectionId?: string;\n  status: string;`;
if (source.includes(typed)) {
  console.log('Inbox conversation connection id type already present.');
  process.exit(0);
}
const anchor = `  accountName?: string;\n  status: string;`;
if (!source.includes(anchor)) {
  throw new Error('Multi-account type fix failed: LiveConversation anchor not found.');
}
source = source.replace(anchor, typed);
fs.writeFileSync(path, source);
console.log('Inbox conversations now expose a stable connection id type.');
