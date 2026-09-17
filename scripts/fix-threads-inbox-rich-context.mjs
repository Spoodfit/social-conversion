import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Threads rich inbox patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Threads runtime: ask Meta for author pictures and persist a complete source snapshot.
// Meta exposes profile_picture_url on current Threads media/reply fields. No public-profile
// discovery permission is required for this best-effort path.
const runtimePath = 'src/worker/threads-runtime-sync.ts';
let runtime = fs.readFileSync(runtimePath, 'utf8');
if (!runtime.includes('SC_THREADS_RICH_CONTEXT_RUNTIME_V1')) {
  runtime = replaceOnce(
    runtime,
    `  username?: unknown;\n  has_replies?: unknown;`,
    `  username?: unknown;\n  profile_picture_url?: unknown;\n  has_replies?: unknown;`,
    'Threads media avatar field',
  );

  runtime = runtime.replaceAll(
    `'id,text,timestamp,media_type,media_url,thumbnail_url,permalink,username,has_replies'`,
    `'id,text,timestamp,media_type,media_url,thumbnail_url,permalink,username,profile_picture_url,has_replies'`,
  );
  runtime = runtime.replaceAll(
    `'id,text,timestamp,media_type,permalink,username,is_reply_owned_by_me,root_post,replied_to'`,
    `'id,text,timestamp,media_type,media_url,thumbnail_url,permalink,username,profile_picture_url,is_reply_owned_by_me,root_post,replied_to'`,
  );
  runtime = runtime.replaceAll(
    `'id,text,timestamp,media_type,permalink,username,has_replies'`,
    `'id,text,timestamp,media_type,media_url,thumbnail_url,permalink,username,profile_picture_url,has_replies'`,
  );

  runtime = replaceOnce(
    runtime,
    `    permalink?: string;\n    kind: 'reply' | 'mention';\n    rootPostId?: string;\n    repliedToId?: string;`,
    `    permalink?: string;\n    avatarUrl?: string;\n    kind: 'reply' | 'mention';\n    rootPostId?: string;\n    repliedToId?: string;\n    sourceBody?: string;\n    sourceUrl?: string;\n    sourcePreviewUrl?: string;\n    sourceMediaType?: string;\n    sourcePublishedAt?: string;\n    parentBody?: string;`,
    'interaction enrichment input',
  );

  runtime = replaceOnce(
    runtime,
    `  const context = JSON.stringify({\n    platform: 'threads',\n    interactionType: input.kind,\n    externalPostId: input.rootPostId ?? input.itemId,\n    repliedToId: input.repliedToId,\n    externalUrl: input.permalink,\n  });`,
    `  const sourceId = input.rootPostId ?? input.itemId;\n  const sourceBody = (input.sourceBody ?? '').trim();\n  const context = JSON.stringify({\n    kind: 'publication',\n    externalContentId: sourceId,\n    title: input.kind === 'mention'\n      ? (normalizedUsername ? \`Thread de @\${normalizedUsername}\` : 'Thread avec mention')\n      : 'Votre Thread',\n    body: sourceBody || undefined,\n    url: input.sourceUrl ?? input.permalink,\n    mediaType: input.sourceMediaType,\n    previewUrl: input.sourcePreviewUrl,\n    publishedAt: input.sourcePublishedAt,\n    interactionType: input.kind,\n    parentBody: input.parentBody,\n    repliedToId: input.repliedToId,\n  });`,
    'rich publication context',
  );

  runtime = replaceOnce(
    runtime,
    `      \`INSERT INTO contacts\n         (id, workspace_id, external_id, platform, display_name, handle, metadata_json, created_at, updated_at)\n       VALUES (?, ?, ?, 'threads', ?, ?, '{}', ?, ?)\n       ON CONFLICT(id) DO UPDATE SET\n         display_name = excluded.display_name,\n         handle = excluded.handle,\n         updated_at = excluded.updated_at\`,\n    ).bind(contactId, connection.workspace_id, externalContactId, displayName, normalizedUsername ? \`@\${normalizedUsername}\` : null, input.occurredAt, now),`,
    `      \`INSERT INTO contacts\n         (id, workspace_id, external_id, platform, display_name, handle, metadata_json, created_at, updated_at)\n       VALUES (?, ?, ?, 'threads', ?, ?, ?, ?, ?)\n       ON CONFLICT(id) DO UPDATE SET\n         display_name = excluded.display_name,\n         handle = excluded.handle,\n         metadata_json = CASE WHEN excluded.metadata_json <> '{}' THEN excluded.metadata_json ELSE contacts.metadata_json END,\n         updated_at = excluded.updated_at\`,\n    ).bind(\n      contactId,\n      connection.workspace_id,\n      externalContactId,\n      displayName,\n      normalizedUsername ? \`@\${normalizedUsername}\` : null,\n      input.avatarUrl ? JSON.stringify({ avatarUrl: input.avatarUrl }) : '{}',\n      input.occurredAt,\n      now,\n    ),`,
    'Threads avatar persistence',
  );

  runtime = replaceOnce(
    runtime,
    `      \`INSERT OR IGNORE INTO messages\n         (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at, context_json)\n       VALUES (?, ?, ?, 'inbound', 'comment', ?, 'received', ?, ?, ?)\`,\n    ).bind(messageId, conversationId, externalMessageId, input.body, input.occurredAt, now, context),`,
    `      \`INSERT INTO messages\n         (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at, context_json)\n       VALUES (?, ?, ?, 'inbound', 'comment', ?, 'received', ?, ?, ?)\n       ON CONFLICT(id) DO UPDATE SET\n         body = excluded.body,\n         sent_at = excluded.sent_at,\n         context_json = excluded.context_json\`,\n    ).bind(messageId, conversationId, externalMessageId, input.body, input.occurredAt, now, context),`,
    'Threads existing message enrichment',
  );

  runtime = replaceOnce(
    runtime,
    `      const replies = await fetchThreadConversation(rootId, token, fetchImpl);\n      let count = 0;`,
    `      const replies = await fetchThreadConversation(rootId, token, fetchImpl);\n      const replyPairs: Array<[string, ThreadsReply]> = replies\n        .map((candidate): [string, ThreadsReply] => [text(candidate.id, 250), candidate])\n        .filter(([id]) => Boolean(id));\n      const repliesById = new Map<string, ThreadsReply>(replyPairs);\n      let count = 0;`,
    'reply parent lookup',
  );

  runtime = replaceOnce(
    runtime,
    `        if (reply.is_reply_owned_by_me === true || (self && username.toLowerCase() === self)) continue;\n        if (await upsertInteraction(db, connection, {\n          itemId,\n          username,\n          body,\n          occurredAt,\n          permalink: safeHttps(reply.permalink),\n          kind: 'reply',\n          rootPostId: text(reply.root_post?.id, 250) || rootId,\n          repliedToId: text(reply.replied_to?.id, 250) || undefined,\n        })) count += 1;`,
    `        if (reply.is_reply_owned_by_me === true || (self && username.toLowerCase() === self)) continue;\n        const repliedToId = text(reply.replied_to?.id, 250) || undefined;\n        const parent = repliedToId && repliedToId !== rootId ? repliesById.get(repliedToId) : undefined;\n        if (await upsertInteraction(db, connection, {\n          itemId,\n          username,\n          body,\n          occurredAt,\n          permalink: safeHttps(reply.permalink),\n          avatarUrl: safeHttps(reply.profile_picture_url),\n          kind: 'reply',\n          rootPostId: text(reply.root_post?.id, 250) || rootId,\n          repliedToId,\n          sourceBody: text(post.text),\n          sourceUrl: safeHttps(post.permalink),\n          sourcePreviewUrl: safeHttps(post.thumbnail_url) ?? safeHttps(post.media_url),\n          sourceMediaType: text(post.media_type, 80) || undefined,\n          sourcePublishedAt: iso(post.timestamp),\n          parentBody: parent ? text(parent.text, 1_200) || undefined : undefined,\n        })) count += 1;`,
    'reply source context and avatar',
  );

  runtime = replaceOnce(
    runtime,
    `    if (await upsertInteraction(db, connection, {\n      itemId,\n      username,\n      body,\n      occurredAt,\n      permalink: safeHttps(mention.permalink),\n      kind: 'mention',\n      rootPostId: itemId,\n    })) saved += 1;`,
    `    if (await upsertInteraction(db, connection, {\n      itemId,\n      username,\n      body,\n      occurredAt,\n      permalink: safeHttps(mention.permalink),\n      avatarUrl: safeHttps(mention.profile_picture_url),\n      kind: 'mention',\n      rootPostId: itemId,\n      sourceBody: body,\n      sourceUrl: safeHttps(mention.permalink),\n      sourcePreviewUrl: safeHttps(mention.thumbnail_url) ?? safeHttps(mention.media_url),\n      sourceMediaType: text(mention.media_type, 80) || undefined,\n      sourcePublishedAt: occurredAt,\n    })) saved += 1;`,
    'mention source context and avatar',
  );

  runtime += '\n// SC_THREADS_RICH_CONTEXT_RUNTIME_V1\n';
  fs.writeFileSync(runtimePath, runtime);
}

// 2) Expose Threads interaction kind in the existing publication-context contract so the UI
// can distinguish a reply from a mention without inventing a separate message model.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_THREADS_RICH_CONTEXT_LIVE_DATA_V1')) {
  liveData = replaceOnce(
    liveData,
    `  publishedAt?: string;\n};`,
    `  publishedAt?: string;\n  interactionType?: 'reply' | 'mention';\n  parentBody?: string;\n};`,
    'API context type',
  );
  liveData = replaceOnce(
    liveData,
    `      publishedAt: stringOrUndefined(parsed.publishedAt, 80),`,
    `      publishedAt: stringOrUndefined(parsed.publishedAt, 80),\n      interactionType: parsed.interactionType === 'reply' || parsed.interactionType === 'mention' ? parsed.interactionType : undefined,\n      parentBody: stringOrUndefined(parsed.parentBody, 1_200),`,
    'API context parser',
  );
  liveData += '\n// SC_THREADS_RICH_CONTEXT_LIVE_DATA_V1\n';
  fs.writeFileSync(liveDataPath, liveData);
}

// 3) Use the already-existing rich context card and avatar component in Inbox.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_THREADS_RICH_CONTEXT_UI_V1')) {
  app = replaceOnce(
    app,
    `  publishedAt?: string;\n};`,
    `  publishedAt?: string;\n  interactionType?: 'reply' | 'mention';\n  parentBody?: string;\n};`,
    'frontend context type',
  );

  app = app.replaceAll(
    `{conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}`,
    `{conversation.latestMessage?.context?.interactionType === 'mention' ? 'Mention' : conversation.latestMessage?.context?.interactionType === 'reply' ? 'Réponse' : conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}`,
  );

  app = app.replaceAll(
    `<small className="sc20-context-label"><MessageCircle size={11} /> Commentaire sur {platformLabel(selected.platform)} · {selected.accountName || 'Compte connecté'}</small>`,
    `<small className="sc20-context-label"><MessageCircle size={11} /> {message.context.interactionType === 'mention' ? 'Mention dans un Thread' : message.context.interactionType === 'reply' ? 'Réponse à votre Thread' : \`Commentaire sur \${platformLabel(selected.platform)}\`} · {selected.accountName || 'Compte connecté'}</small>`,
  );
  app = app.replaceAll(
    `{excerpt && <span>{excerpt}</span>}`,
    `{message.context.parentBody && <span className="sc25-parent-context"><b>En réponse à :</b> {message.context.parentBody}</span>}\n                      {excerpt && <span>{excerpt}</span>}`,
  );

  app += '\n/* SC_THREADS_RICH_CONTEXT_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

const cssPath = 'src/social-core.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('SC_THREADS_RICH_CONTEXT_CSS_V1')) {
  css += `\n\n/* SC_THREADS_RICH_CONTEXT_CSS_V1 */\n.sc25-parent-context{display:block!important;margin-top:5px;padding:6px 8px;border-radius:8px;background:#f7f6fb;color:#62677f;font-size:7px;line-height:1.4}.sc25-parent-context b{color:#343852;font-weight:700}\n`;
  fs.writeFileSync(cssPath, css);
}

await import('./fix-threads-content-rendering-dates.mjs');

console.log('Threads Inbox now exposes real avatars and explicit reply/mention source context.');
