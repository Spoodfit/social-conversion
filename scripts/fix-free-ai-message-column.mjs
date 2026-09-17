import fs from 'node:fs';

const path = 'src/worker/ai-drafts.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('SELECT m.direction, m.type, m.body, m.context_json, m.sent_at')) {
  source = source.replace(
    'SELECT m.direction, m.type, m.body, m.context_json, m.sent_at',
    'SELECT m.direction, m.message_type AS type, m.body, m.context_json, m.sent_at',
  );
  fs.writeFileSync(path, source);
  console.log('Free Inbox AI message_type query fixed.');
} else {
  console.log('Free Inbox AI message_type query already fixed.');
}
