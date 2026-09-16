import fs from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Inbox todo semantics patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// "À traiter" is a reply queue, not a read queue. Reading a conversation must never
// resolve it. A conversation leaves the queue only once an outbound reply is newer
// than the latest inbound interaction.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_INBOX_TODO_SEMANTICS_V1')) {
  liveData = replaceRequired(
    liveData,
    `  latest_message_sent_at: string | null;\n  last_read_at: string | null;`,
    `  latest_message_sent_at: string | null;\n  latest_inbound_sent_at: string | null;\n  latest_outbound_sent_at: string | null;\n  last_read_at: string | null;`,
    'row chronology fields',
  );

  liveData = replaceRequired(
    liveData,
    `       (SELECT m.sent_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_sent_at,\n       (SELECT cr.last_read_at FROM conversation_reads cr`,
    `       (SELECT m.sent_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS latest_message_sent_at,\n       (SELECT MAX(m.sent_at) FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'inbound') AS latest_inbound_sent_at,\n       (SELECT MAX(m.sent_at) FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'outbound') AS latest_outbound_sent_at,\n       (SELECT cr.last_read_at FROM conversation_reads cr`,
    'reply chronology select',
  );

  liveData = replaceRequired(
    liveData,
    `      needsReply: row.latest_message_direction === 'inbound',`,
    `      needsReply: Boolean(\n        row.latest_inbound_sent_at\n        && (!row.latest_outbound_sent_at || row.latest_inbound_sent_at > row.latest_outbound_sent_at)\n      ),`,
    'needsReply semantics',
  );

  liveData += '\n// SC_INBOX_TODO_SEMANTICS_V1\n';
  fs.writeFileSync(liveDataPath, liveData);
}

await import('./apply-reply-experience.mjs');
console.log('Inbox À traiter now remains independent from read/unread state.');
