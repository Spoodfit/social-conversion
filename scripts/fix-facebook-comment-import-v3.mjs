import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Facebook comment import v3 failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const path = 'src/worker/facebook-runtime-sync.ts';
let source = fs.readFileSync(path, 'utf8');

if (!source.includes('SC_FACEBOOK_COMMENT_IMPORT_V3')) {
  source = replaceOnce(
    source,
`type FacebookComment = {
  id?: unknown;
  message?: unknown;
  created_time?: unknown;
  from?: { id?: unknown; name?: unknown };
};`,
`type FacebookComment = {
  id?: unknown;
  message?: unknown;
  created_time?: unknown;
  from?: { id?: unknown; name?: unknown };
  parent?: { id?: unknown; from?: { id?: unknown; name?: unknown } };
};`,
    'FacebookComment parent shape',
  );

  const start = source.indexOf('async function syncComments(');
  const end = source.indexOf('\nfunction externalParticipant(', start);
  if (start < 0 || end < 0) throw new Error('Facebook comment import v3 failed: syncComments section not found.');

  const block = [
"async function storedCommentContact(",
"  db: D1Database,",
"  connection: FacebookConnectionRow,",
"  externalMessageId: string,",
"): Promise<{ externalId: string; name: string } | undefined> {",
"  const row = await db.prepare(",
"    `SELECT ct.external_id, ct.display_name",
"     FROM messages m",
"     JOIN conversations c ON c.id = m.conversation_id",
"     JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id",
"     WHERE c.workspace_id = ? AND c.connection_id = ? AND m.external_id = ?",
"     LIMIT 1`,",
"  ).bind(connection.workspace_id, connection.id, externalMessageId).first<{ external_id: string; display_name: string }>();",
"  return row ? { externalId: row.external_id, name: row.display_name } : undefined;",
"}",
"",
"async function fetchFacebookCommentPages(",
"  env: Env,",
"  postId: string,",
"  token: string,",
"  fetchImpl: typeof fetch,",
"  fields: string,",
"): Promise<FacebookComment[]> {",
"  const initial = new URL(`https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(postId)}/comments`);",
"  initial.searchParams.set('fields', fields);",
"  initial.searchParams.set('filter', 'stream');",
"  initial.searchParams.set('order', 'chronological');",
"  initial.searchParams.set('limit', '100');",
"  let next: string | undefined = initial.toString();",
"  const comments: FacebookComment[] = [];",
"  for (let page = 0; next && page < 3; page += 1) {",
"    const payload = await graphGet<GraphPage<FacebookComment>>(fetchImpl, next, token);",
"    if (Array.isArray(payload.data)) comments.push(...payload.data);",
"    next = typeof payload.paging?.next === 'string' && payload.paging.next.startsWith('https://')",
"      ? payload.paging.next",
"      : undefined;",
"  }",
"  return comments;",
"}",
"",
"async function syncComments(",
"  db: D1Database,",
"  env: Env,",
"  connection: FacebookConnectionRow,",
"  token: string,",
"  posts: FacebookPost[],",
"  fetchImpl: typeof fetch,",
"): Promise<number> {",
"  let saved = 0;",
"  let attemptedPosts = 0;",
"  let failedPosts = 0;",
"  let lastError: unknown;",
"",
"  for (const post of posts.slice(0, MAX_COMMENT_POSTS)) {",
"    const postId = text(post.id, 220);",
"    if (!postId) continue;",
"    attemptedPosts += 1;",
"",
"    const firstAttachment = Array.isArray(post.attachments?.data) ? post.attachments?.data?.[0] : undefined;",
"    const mediaType = text(firstAttachment?.media_type, 60) || text(firstAttachment?.type, 60) || undefined;",
"    const postBody = text(post.message) || 'Publication Facebook';",
"    const postTitle = postBody.split(/\\r?\\n/)[0]?.slice(0, 220) || 'Publication Facebook';",
"    const postUrl = safeHttps(post.permalink_url);",
"    const previewUrl = safeHttps(post.full_picture);",
"    const publishedAt = iso(post.created_time);",
"    const contentContextJson = JSON.stringify({",
"      kind: 'publication',",
"      externalContentId: postId,",
"      title: postTitle,",
"      body: postBody,",
"      url: postUrl,",
"      mediaType,",
"      previewUrl,",
"      publishedAt,",
"    });",
"",
"    let comments: FacebookComment[] = [];",
"    try {",
"      comments = await fetchFacebookCommentPages(",
"        env, postId, token, fetchImpl, 'id,message,created_time,from{id,name},parent{id,from{id,name}}',",
"      );",
"    } catch (error) {",
"      try {",
"        comments = await fetchFacebookCommentPages(env, postId, token, fetchImpl, 'id,message,created_time,parent{id}');",
"      } catch (fallbackError) {",
"        failedPosts += 1;",
"        lastError = fallbackError instanceof Error ? fallbackError : error;",
"        continue;",
"      }",
"    }",
"",
"    comments.sort((a, b) => {",
"      const aTime = Date.parse(text(a.created_time, 80)) || 0;",
"      const bTime = Date.parse(text(b.created_time, 80)) || 0;",
"      return aTime - bTime;",
"    });",
"",
"    for (const comment of comments) {",
"      const id = text(comment.id, 220);",
"      const body = text(comment.message);",
"      const occurredAt = iso(comment.created_time);",
"      if (!id || !body || !occurredAt) continue;",
"",
"      const authorId = text(comment.from?.id, 220);",
"      const authorName = text(comment.from?.name, 180);",
"      const parentId = text(comment.parent?.id, 220);",
"      const parentAuthorId = text(comment.parent?.from?.id, 220);",
"      const parentAuthorName = text(comment.parent?.from?.name, 180);",
"      const parentContact = parentId ? await storedCommentContact(db, connection, parentId) : undefined;",
"      const outbound = authorId === connection.external_account_id;",
"",
"      let externalContactId = '';",
"      let contactName = '';",
"      if (outbound) {",
"        externalContactId = parentContact?.externalId",
"          || (parentAuthorId && parentAuthorId !== connection.external_account_id ? parentAuthorId : '');",
"        contactName = parentContact?.name",
"          || (parentAuthorId && parentAuthorId !== connection.external_account_id",
"            ? (parentAuthorName || `Utilisateur Facebook ${parentAuthorId.slice(-4)}`)",
"            : '');",
"        if (!externalContactId) continue;",
"      } else if (authorId) {",
"        externalContactId = authorId;",
"        contactName = authorName || `Utilisateur Facebook ${authorId.slice(-4)}`;",
"      } else if (parentContact) {",
"        externalContactId = parentContact.externalId;",
"        contactName = parentContact.name;",
"      } else {",
"        externalContactId = `commenter:${id}`;",
"        contactName = 'Utilisateur Facebook';",
"      }",
"",
"      if (await upsertConversationEvent(db, {",
"        workspaceId: connection.workspace_id,",
"        connectionId: connection.id,",
"        externalContactId,",
"        contactName,",
"        externalMessageId: id,",
"        body,",
"        occurredAt,",
"        type: 'comment',",
"        direction: outbound ? 'outbound' : 'inbound',",
"        contentContextJson,",
"      })) saved += 1;",
"    }",
"  }",
"",
"  if (attemptedPosts > 0 && failedPosts === attemptedPosts && lastError) throw lastError;",
"  return saved;",
"}",
"",
  ].join('\n');

  source = source.slice(0, start) + block + source.slice(end);

  source = replaceOnce(
    source,
`  let messages = 0;
  let failed = 0;
  for (const connection of connections) {`,
`  let messages = 0;
  let failed = 0;
  const issues: Array<{ connectionId: string; displayName: string; errors: string[] }> = [];
  for (const connection of connections) {`,
    'sync issues accumulator',
  );

  source = replaceOnce(
    source,
`    messages += result.messages;
    if (result.errors.length) failed += 1;
  }
  return { synced, skipped, failed, posts, comments, messages };`,
`    messages += result.messages;
    if (result.errors.length) {
      failed += 1;
      issues.push({ connectionId: connection.id, displayName: connection.display_name, errors: result.errors.slice(0, 4) });
    }
  }
  return { synced, skipped, failed, posts, comments, messages, issues };`,
    'sync issues response',
  );

  source += '\n// SC_FACEBOOK_COMMENT_IMPORT_V3\n';
  fs.writeFileSync(path, source);
}

console.log('Facebook comment import v3: replies, pagination and sync diagnostics applied.');
