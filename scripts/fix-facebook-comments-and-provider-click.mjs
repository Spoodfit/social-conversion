import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Facebook comments/provider click fix failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Facebook comments: do not drop comments when Meta withholds the author,
// tolerate isolated post failures, and retry without the `from` field when needed.
const syncPath = 'src/worker/facebook-runtime-sync.ts';
let sync = fs.readFileSync(syncPath, 'utf8');
if (!sync.includes('SC_FACEBOOK_COMMENT_IMPORT_V2')) {
  const start = sync.indexOf('async function syncComments(');
  const end = sync.indexOf('\nfunction externalParticipant(', start);
  if (start < 0 || end < 0) throw new Error('Facebook comments/provider click fix failed: syncComments block not found.');

  const replacement = `async function syncComments(
  db: D1Database,
  env: Env,
  connection: FacebookConnectionRow,
  token: string,
  posts: FacebookPost[],
  fetchImpl: typeof fetch,
): Promise<number> {
  let saved = 0;
  let attemptedPosts = 0;
  let failedPosts = 0;
  let lastError: unknown;

  for (const post of posts.slice(0, MAX_COMMENT_POSTS)) {
    const postId = text(post.id, 220);
    if (!postId) continue;
    attemptedPosts += 1;

    const url = new URL(\`https://graph.facebook.com/\${graphVersion(env)}/\${encodeURIComponent(postId)}/comments\`);
    url.searchParams.set('fields', 'id,message,created_time,from{id,name}');
    url.searchParams.set('filter', 'stream');
    url.searchParams.set('limit', '100');

    let payload: GraphPage<FacebookComment>;
    try {
      payload = await graphGet<GraphPage<FacebookComment>>(fetchImpl, url.toString(), token);
    } catch (error) {
      // Meta can expose the comment body while withholding the author identity.
      // Retry without asking for `from` instead of making the entire Inbox empty.
      const fallbackUrl = new URL(url.toString());
      fallbackUrl.searchParams.set('fields', 'id,message,created_time');
      try {
        payload = await graphGet<GraphPage<FacebookComment>>(fetchImpl, fallbackUrl.toString(), token);
      } catch (fallbackError) {
        failedPosts += 1;
        lastError = fallbackError instanceof Error ? fallbackError : error;
        continue;
      }
    }

    for (const comment of Array.isArray(payload.data) ? payload.data : []) {
      const id = text(comment.id, 220);
      const body = text(comment.message);
      const authorId = text(comment.from?.id, 220);
      const occurredAt = iso(comment.created_time);
      if (!id || !body || !occurredAt) continue;
      if (authorId && authorId === connection.external_account_id) continue;

      // Recent Graph API responses may omit `from` for a user's comment even when
      // the Page is allowed to read the comment itself. Keep a stable synthetic
      // contact id so the comment still appears and remains idempotent.
      const externalContactId = authorId || \`commenter:\${id}\`;
      const contactName = text(comment.from?.name, 180)
        || (authorId ? \`Utilisateur Facebook \${authorId.slice(-4)}\` : 'Utilisateur Facebook');

      if (await upsertConversationEvent(db, {
        workspaceId: connection.workspace_id,
        connectionId: connection.id,
        externalContactId,
        contactName,
        externalMessageId: id,
        body,
        occurredAt,
        type: 'comment',
        direction: 'inbound',
      })) saved += 1;
    }
  }

  // One inaccessible/deleted post must not suppress comments from every other post.
  // If every attempted post failed, preserve the provider failure signal.
  if (attemptedPosts > 0 && failedPosts === attemptedPosts && lastError) throw lastError;
  return saved;
}
`;

  sync = sync.slice(0, start) + replacement + sync.slice(end);

  sync = replaceOnce(sync,
`    if (scopes.includes('pages_read_engagement') || scopes.includes('pages_manage_engagement') || scopes.includes('pages_read_user_content')) {
      try {
        comments = await syncComments(db, env, connection, token, posts, fetchImpl);
      } catch (error) {
        errors.push(\`comments: \${error instanceof Error ? error.message : 'unknown'}\`);
      }
    }`,
`    // The page token is the source of truth. Stored permission metadata can be stale
    // after a Meta re-authorization, so attempt comment synchronization whenever
    // Page posts are readable and let Graph return an explicit permission error.
    if (posts.length) {
      try {
        comments = await syncComments(db, env, connection, token, posts, fetchImpl);
      } catch (error) {
        errors.push(\`comments: \${error instanceof Error ? error.message : 'unknown'}\`);
      }
    }`,
    'comment permission gate');

  sync += '\n// SC_FACEBOOK_COMMENT_IMPORT_V2\n';
  fs.writeFileSync(syncPath, sync);
}

// 2) Planner: synchronized Facebook/Instagram posts are read-only provider items.
// Their cards already say "Ouvrir sur le réseau", so clicking must actually open
// the original publication instead of routing into the publishing composer.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_FACEBOOK_PROVIDER_OPEN_V2')) {
  app = replaceOnce(app,
`  function editPublication(publication: Publication) {
    // Les contenus synchronisés s’ouvrent eux aussi dans le même volet d’édition.`,
`  function editPublication(publication: Publication) {
    if (publication.readOnly && !publication.providerEditable) {
      if (publication.externalUrl) {
        window.open(publication.externalUrl, '_blank', 'noopener,noreferrer');
      } else {
        setToast('Cette publication synchronisée ne fournit pas de lien ouvrable.');
      }
      return;
    }
    // Les contenus synchronisés modifiables (YouTube) s’ouvrent dans le volet d’édition.`,
    'provider card click');

  app = replaceOnce(app,
`<span><strong>{publication.body}</strong><small>{publication.targets.map((target) => target.displayName).join(' · ')}</small><em className={\`sc16-list-status \${publication.status === 'draft' ? 'draft' : 'scheduled'}\`}>{publication.status === 'draft' ? 'Brouillon' : 'Programmé'}</em></span>`,
`<span><strong>{publication.body}</strong><small>{publication.targets.map((target) => target.displayName).join(' · ')}</small>{!publication.readOnly && <em className={\`sc16-list-status \${publication.status === 'draft' ? 'draft' : 'scheduled'}\`}>{publication.status === 'draft' ? 'Brouillon' : 'Programmé'}</em>}</span>`,
    'duplicate provider list status');

  app += '\n/* SC_FACEBOOK_PROVIDER_OPEN_V2 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('Facebook comments import and synchronized provider click behavior fixed.');
