import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Facebook permission gate fix failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// The stored permission list must reflect what Meta actually granted. Falling back to a
// hard-coded list makes the runtime believe it owns permissions that are absent from the token.
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

// Facebook user comments are user-generated Page content. Meta requires
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
      errors.push('comments: permission Meta pages_read_user_content manquante sur le jeton Facebook');
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
      errors.push('messenger: permission Meta pages_messaging manquante sur le jeton Facebook');
    }`,
    'Messenger permission gate',
  );

  sync += '\n// SC_FACEBOOK_PERMISSION_GATES_V1\n';
  fs.writeFileSync(syncPath, sync);
}

// Do not expose Meta's raw Graph JSON to the user. Explain the actual blocking permission
// and the exact recovery action instead.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_FACEBOOK_PERMISSION_GUIDANCE_V1')) {
  const inboxFn = 'function InboxPage(';
  const inboxIndex = app.indexOf(inboxFn);
  if (inboxIndex < 0) throw new Error('Facebook permission gate fix failed: InboxPage anchor not found.');

  const helper = `function facebookInboxSyncMessage(sync: NonNullable<InboxPayload['facebookSync']>) {\n  const issue = sync.issues?.flatMap((entry) => entry.errors ?? []).find(Boolean) ?? '';\n  if (issue.includes('pages_read_user_content')) {\n    return 'Les publications Facebook sont bien connectées, mais Meta n’autorise pas encore la lecture des commentaires. Activez pages_read_user_content dans le cas d’usage « Gérer tout sur votre Page », puis reconnectez Facebook dans Réglages.';\n  }\n  if (issue.includes('pages_messaging')) {\n    return 'Facebook est connecté, mais Messenger n’est pas autorisé sur ce jeton. Activez pages_messaging dans le cas d’usage Messenger, puis reconnectez Facebook dans Réglages.';\n  }\n  return issue ? 'Synchronisation Facebook incomplète. ' + issue : 'Synchronisation Facebook incomplète. Actualisez ou reconnectez la Page.';\n}\n\n`;
  app = app.slice(0, inboxIndex) + helper + app.slice(inboxIndex);

  app = replaceOnce(
    app,
    `{sync && sync.failed > 0 && <div className="sc22-sync-warning">Facebook n’a pas pu synchroniser toutes les interactions. {sync.issues?.[0]?.errors?.[0] || 'Utilisez Actualiser ; si le problème persiste, reconnectez la Page.'}</div>}`,
    `{sync && sync.failed > 0 && <div className="sc22-sync-warning">{facebookInboxSyncMessage(sync)}</div>}`,
    'Inbox sync warning',
  );

  app += '\n/* SC_FACEBOOK_PERMISSION_GUIDANCE_V1 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('Facebook Inbox now respects granted Meta permissions and shows actionable permission guidance.');
