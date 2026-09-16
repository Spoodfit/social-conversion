import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`YouTube avatar patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const path = 'src/worker/provider-inbox-sync.ts';
let source = fs.readFileSync(path, 'utf8');
if (source.includes('SC_YOUTUBE_CONTACT_AVATAR_V1')) {
  console.log('YouTube contact avatars already applied.');
  process.exit(0);
}

source = replaceOnce(
  source,
  `        authorDisplayName?: unknown;\n        textOriginal?: unknown;`,
  `        authorDisplayName?: unknown;\n        authorProfileImageUrl?: unknown;\n        textOriginal?: unknown;`,
  'YouTube author image field',
);

const loop = `    for (const event of normalizeYouTubeCommentThreads(connection, workspaceId, threads, context)) {\n      const result = await persistSocialEvent(db, event);\n      if (result === 'created') persisted += 1;\n    }`;
const enriched = `    for (const event of normalizeYouTubeCommentThreads(connection, workspaceId, threads, context)) {\n      const result = await persistSocialEvent(db, event);\n      if (result === 'created') persisted += 1;\n      const sourceThread = threads.find((thread) => stringValue(thread.snippet?.topLevelComment?.id, 200) === event.externalEventId);\n      const avatarUrl = stringValue(sourceThread?.snippet?.topLevelComment?.snippet?.authorProfileImageUrl, 2_000);\n      if (avatarUrl.startsWith('https://')) {\n        const contactId = \`${'${event.workspaceId}'}:${'${event.platform}'}:${'${event.externalContactId}'}\`;\n        await db.prepare(\n          \`UPDATE contacts\n           SET metadata_json = json_set(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.avatarUrl', ?), updated_at = ?\n           WHERE id = ? AND workspace_id = ?\`,\n        ).bind(avatarUrl, new Date().toISOString(), contactId, workspaceId).run();\n      }\n    }`;
source = replaceOnce(source, loop, enriched, 'avatar persistence after YouTube sync');
source += '\n// SC_YOUTUBE_CONTACT_AVATAR_V1\n';
fs.writeFileSync(path, source);
console.log('YouTube commenter avatars are persisted in contact metadata.');
