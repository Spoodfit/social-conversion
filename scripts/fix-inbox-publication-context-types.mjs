import fs from 'node:fs';

const path = 'src/worker/persistence.ts';
let source = fs.readFileSync(path, 'utf8');
const marker = 'SC_INBOX_PUBLICATION_CONTEXT_NULL_FIX_V1';

if (!source.includes(marker)) {
  const before = `      remote = await db.prepare(\n        \`SELECT body, media_type, external_url FROM planner_remote_posts\n         WHERE workspace_id = ? AND connection_id = ? AND platform = ? AND external_id = ?\n         LIMIT 1\`,\n      ).bind(event.workspaceId, event.connectionId, event.platform, externalContentId).first<RemoteContextRow>();`;
  const after = `      remote = (await db.prepare(\n        \`SELECT body, media_type, external_url FROM planner_remote_posts\n         WHERE workspace_id = ? AND connection_id = ? AND platform = ? AND external_id = ?\n         LIMIT 1\`,\n      ).bind(event.workspaceId, event.connectionId, event.platform, externalContentId).first<RemoteContextRow>()) ?? undefined;`;
  if (!source.includes(before)) throw new Error('Inbox publication context null fix failed: persistence lookup anchor not found.');
  source = source.replace(before, after);
  source += `\n// ${marker}\n`;
  fs.writeFileSync(path, source);
}

console.log('Inbox publication context D1 nullable lookup fixed.');
