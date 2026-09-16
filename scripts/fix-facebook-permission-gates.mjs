import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Facebook permission gate fix failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Keep the stored permission list truthful. A hard-coded fallback made the runtime
// believe comments were authorized even when Meta had never granted the permission.
const oauthPath = 'src/worker/meta-oauth.ts';
let oauth = fs.readFileSync(oauthPath, 'utf8');
if (!oauth.includes('SC_FACEBOOK_PERMISSION_TRUTH_V1')) {
  oauth = oauth.replace(
`const fallbackMetaScopes = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
] as const;

`,
'',
  );
  oauth = replaceOnce(
    oauth,
    `    return granted.length ? [...new Set(granted)].sort() : [...fallbackMetaScopes];`,
    `    return [...new Set(granted)].sort();`,
    'granted permissions result',
  );
  oauth = replaceOnce(
    oauth,
    `  } catch {
    return [...fallbackMetaScopes];
  }`,
    `  } catch {
    // Fail closed: never claim a Meta permission we could not verify on the user token.
    return [];
  }`,
    'granted permissions fallback',
  );
  oauth += '\n// SC_FACEBOOK_PERMISSION_TRUTH_V1\n';
  fs.writeFileSync(oauthPath, oauth);
}

// User comments are user-generated Page content. Meta requires
// pages_read_user_content specifically; pages_read_engagement is not a substitute.
const syncPath = 'src/worker/facebook-runtime-sync.ts';
let sync = fs.readFileSync(syncPath, 'utf8');
if (!sync.includes('SC_FACEBOOK_PERMISSION_GATES_V1')) {
  sync = replaceOnce(
    sync,
`    if (scopes.includes('pages_read_engagement') || scopes.includes('pages_manage_engagement') || scopes.includes('pages_read_user_content')) {
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

console.log('Facebook Inbox now respects the permissions Meta actually granted.');
