import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Facebook permission gate fix failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// User comments are user-generated Page content. Meta requires
// pages_read_user_content specifically; pages_read_engagement is not a substitute.
const syncPath = 'src/worker/facebook-runtime-sync.ts';
let sync = fs.readFileSync(syncPath, 'utf8');
if (!sync.includes('SC_FACEBOOK_PERMISSION_GATES_V1')) {
  sync = replaceOnce(
    sync,
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
`    if (scopes.includes('pages_read_user_content')) {
      try {
        comments = await syncComments(db, env, connection, token, posts, fetchImpl);
      } catch (error) {
        errors.push(\`comments: \${error instanceof Error ? error.message : 'unknown'}\`);
      }
    } else {
      errors.push('comments: Meta bloque la lecture des commentaires car pages_read_user_content n’est pas accordée. Activez cette autorisation dans le cas d’usage « Gérer tout sur votre Page », puis reconnectez Facebook dans Réglages.');
    }`,
    'comment permission gate',
  );

  sync = replaceOnce(
    sync,
`    if (scopes.includes('pages_messaging')) {
      try {
        messages = await syncMessages(db, env, connection, token, fetchImpl);
      } catch (error) {
        errors.push(\`messenger: \${error instanceof Error ? error.message : 'unknown'}\`);
      }
    }`,
`    if (scopes.includes('pages_messaging')) {
      try {
        messages = await syncMessages(db, env, connection, token, fetchImpl);
      } catch (error) {
        errors.push(\`messenger: \${error instanceof Error ? error.message : 'unknown'}\`);
      }
    } else {
      errors.push('messenger: Meta n’a pas accordé pages_messaging à ce jeton. Activez l’autorisation Messenger puis reconnectez Facebook dans Réglages.');
    }`,
    'Messenger permission gate',
  );

  sync += '\n// SC_FACEBOOK_PERMISSION_GATES_V1\n';
  fs.writeFileSync(syncPath, sync);
}

console.log('Facebook Inbox now gates comments and Messenger on the exact Meta permissions.');
