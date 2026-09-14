import fs from 'node:fs';

const path = 'src/worker/social-account-oauth.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('SOCIAL_OAUTH_PERSISTENCE_V2')) {
  console.log('Persistent social OAuth v2 already applied.');
  process.exit(0);
}

function replaceFunction(name, nextName, replacement) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`async function ${nextName}(`, start);
  if (start < 0 || end < 0) throw new Error(`Social OAuth persistence patch failed around ${name}.`);
  source = source.slice(0, start) + replacement + '\n\n' + source.slice(end);
}

const uniquenessStart = source.indexOf('async function ensureUniqueAccount(');
const uniquenessEnd = source.indexOf('async function completeYoutube(', uniquenessStart);
if (uniquenessStart < 0 || uniquenessEnd < 0) throw new Error('Social OAuth persistence patch failed: uniqueness block not found.');
const helpers = `async function canonicalConnectionId(
  db: D1Database,
  state: OAuthStateRow,
  provider: SocialOAuthProvider,
  externalAccountId: string,
): Promise<string> {
  const existing = await db.prepare(
    \`SELECT id FROM social_connections
     WHERE workspace_id = ? AND platform = ? AND external_account_id = ? AND id <> ?
     ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1\`,
  ).bind(state.workspace_id, provider, externalAccountId, state.connection_id).first<{ id: string }>();
  return existing?.id ?? state.connection_id;
}

async function mergeConnectionReferences(
  db: D1Database,
  workspaceId: string,
  fromConnectionId: string,
  toConnectionId: string,
) {
  if (fromConnectionId === toConnectionId) return;

  await db.prepare(
    \`DELETE FROM content_post_targets
     WHERE workspace_id = ? AND connection_id = ?
       AND EXISTS (
         SELECT 1 FROM content_post_targets existing
         WHERE existing.workspace_id = content_post_targets.workspace_id
           AND existing.post_id = content_post_targets.post_id
           AND existing.connection_id = ?
       )\`,
  ).bind(workspaceId, fromConnectionId, toConnectionId).run();
  await db.prepare(
    \`UPDATE content_post_targets SET connection_id = ?, updated_at = ?
     WHERE workspace_id = ? AND connection_id = ?\`,
  ).bind(toConnectionId, new Date().toISOString(), workspaceId, fromConnectionId).run();

  await db.prepare(
    \`DELETE FROM publication_remote_sync
     WHERE workspace_id = ? AND connection_id = ?
       AND EXISTS (
         SELECT 1 FROM publication_remote_sync existing
         WHERE existing.workspace_id = publication_remote_sync.workspace_id
           AND existing.post_id = publication_remote_sync.post_id
           AND existing.platform = publication_remote_sync.platform
           AND existing.connection_id = ?
       )\`,
  ).bind(workspaceId, fromConnectionId, toConnectionId).run();
  await db.prepare(
    \`UPDATE publication_remote_sync SET connection_id = ?, updated_at = ?
     WHERE workspace_id = ? AND connection_id = ?\`,
  ).bind(toConnectionId, new Date().toISOString(), workspaceId, fromConnectionId).run();

  await db.prepare(
    \`DELETE FROM content_post_destinations
     WHERE workspace_id = ? AND connection_id = ?
       AND EXISTS (
         SELECT 1 FROM content_post_destinations existing
         WHERE existing.workspace_id = content_post_destinations.workspace_id
           AND existing.post_id = content_post_destinations.post_id
           AND existing.platform = content_post_destinations.platform
           AND existing.connection_id = ?
       )\`,
  ).bind(workspaceId, fromConnectionId, toConnectionId).run();
  await db.prepare(
    \`UPDATE content_post_destinations SET connection_id = ?, updated_at = ?
     WHERE workspace_id = ? AND connection_id = ?\`,
  ).bind(toConnectionId, new Date().toISOString(), workspaceId, fromConnectionId).run();

  await db.prepare(
    \`UPDATE conversations SET connection_id = ?, updated_at = ?
     WHERE workspace_id = ? AND connection_id = ?\`,
  ).bind(toConnectionId, new Date().toISOString(), workspaceId, fromConnectionId).run();
  await db.prepare(
    \`UPDATE outbound_messages SET connection_id = ?, updated_at = ?
     WHERE workspace_id = ? AND connection_id = ?\`,
  ).bind(toConnectionId, new Date().toISOString(), workspaceId, fromConnectionId).run();

  await db.prepare('DELETE FROM oauth_credentials WHERE workspace_id = ? AND connection_id = ?')
    .bind(workspaceId, fromConnectionId).run();
  await db.prepare('DELETE FROM social_connections WHERE workspace_id = ? AND id = ?')
    .bind(workspaceId, fromConnectionId).run();
}
`;
source = source.slice(0, uniquenessStart) + helpers + '\n\n' + source.slice(uniquenessEnd);

replaceFunction('completeYoutube', 'completeTikTok', `async function completeYoutube(
  db: D1Database,
  config: OAuthConfig,
  state: OAuthStateRow,
  code: string,
  fetchImpl: typeof fetch,
) {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  const token = await fetchJson(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new SocialOAuthError('OAUTH_PROVIDER_FAILED', 'Google did not return an access token.');
  }
  const profile = await fetchJson(fetchImpl, 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    method: 'GET',
    headers: { authorization: \`Bearer \${token.access_token}\` },
  }) as { items?: Array<{ id?: unknown; snippet?: { title?: unknown; customUrl?: unknown } }> };
  const channel = Array.isArray(profile.items) ? profile.items[0] : undefined;
  const accountId = typeof channel?.id === 'string' ? channel.id.trim() : '';
  const title = typeof channel?.snippet?.title === 'string' ? channel.snippet.title.trim() : '';
  const customUrl = typeof channel?.snippet?.customUrl === 'string' ? channel.snippet.customUrl.trim() : '';
  if (!accountId || !title) throw new SocialOAuthError('OAUTH_PROFILE_INVALID', 'YouTube channel could not be validated.');

  const connectionId = await canonicalConnectionId(db, state, 'youtube', accountId);
  const existingTokens = await loadOAuthTokens(db, config.keyring, state.workspace_id, connectionId).catch(() => undefined);
  const refreshToken = typeof token.refresh_token === 'string' && token.refresh_token
    ? token.refresh_token
    : existingTokens?.refreshToken;
  if (!refreshToken) {
    throw new SocialOAuthError('OAUTH_PROVIDER_FAILED', 'Google did not return durable OAuth credentials.');
  }

  const scopes = scopesFrom(token.scope, youtubeScopes, /\\s+/);
  const now = new Date().toISOString();
  await db.prepare(
    \`UPDATE social_connections
     SET external_account_id = ?, display_name = ?, handle = ?, status = 'connected', capabilities_json = ?, last_synced_at = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND platform = 'youtube'\`,
  ).bind(
    accountId,
    \`YouTube · \${title}\`,
    customUrl || null,
    JSON.stringify({ comments: scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl'), direct_messages: false, publishing: scopes.includes('https://www.googleapis.com/auth/youtube.upload') }),
    now,
    now,
    connectionId,
    state.workspace_id,
  ).run();
  const accessExpiresAt = expiryFromSeconds(token.expires_in, 3_600);
  await saveOAuthCredentials(db, config.keyring, {
    workspaceId: state.workspace_id,
    connectionId,
    provider: 'youtube',
    accessToken: token.access_token,
    refreshToken,
    scopes,
    accessExpiresAt,
  });
  await mergeConnectionReferences(db, state.workspace_id, state.connection_id, connectionId);
  return { connectionId, accountId, displayName: title, handle: customUrl || undefined, accessExpiresAt };
}`);

replaceFunction('completeTikTok', 'completeSocialOAuth', `async function completeTikTok(
  db: D1Database,
  config: OAuthConfig,
  state: OAuthStateRow,
  code: string,
  fetchImpl: typeof fetch,
) {
  const form = new URLSearchParams({
    client_key: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  const token = await fetchJson(fetchImpl, 'https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    refresh_expires_in?: unknown;
    open_id?: unknown;
    scope?: unknown;
  };
  if (typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' || !token.refresh_token) {
    throw new SocialOAuthError('OAUTH_PROVIDER_FAILED', 'TikTok did not return durable OAuth credentials.');
  }
  const profile = await fetchJson(fetchImpl, 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
    method: 'GET',
    headers: { authorization: \`Bearer \${token.access_token}\` },
  }) as { data?: { user?: { open_id?: unknown; display_name?: unknown } } };
  const accountId = typeof profile.data?.user?.open_id === 'string'
    ? profile.data.user.open_id.trim()
    : typeof token.open_id === 'string'
      ? token.open_id.trim()
      : '';
  const displayName = typeof profile.data?.user?.display_name === 'string' ? profile.data.user.display_name.trim() : '';
  if (!accountId || !displayName) throw new SocialOAuthError('OAUTH_PROFILE_INVALID', 'TikTok profile could not be validated.');

  const connectionId = await canonicalConnectionId(db, state, 'tiktok', accountId);
  const scopes = scopesFrom(token.scope, tiktokScopes, /[\\s,]+/);
  const now = new Date().toISOString();
  await db.prepare(
    \`UPDATE social_connections
     SET external_account_id = ?, display_name = ?, handle = NULL, status = 'connected', capabilities_json = ?, last_synced_at = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND platform = 'tiktok'\`,
  ).bind(
    accountId,
    \`TikTok · \${displayName}\`,
    JSON.stringify({ comments: false, direct_messages: false, publishing: scopes.includes('video.publish'), upload: scopes.includes('video.upload') }),
    now,
    now,
    connectionId,
    state.workspace_id,
  ).run();
  const accessExpiresAt = expiryFromSeconds(token.expires_in, 86_400);
  const refreshExpiresAt = expiryFromSeconds(token.refresh_expires_in, 365 * 24 * 3_600);
  await saveOAuthCredentials(db, config.keyring, {
    workspaceId: state.workspace_id,
    connectionId,
    provider: 'tiktok',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scopes,
    accessExpiresAt,
    refreshExpiresAt,
  });
  await mergeConnectionReferences(db, state.workspace_id, state.connection_id, connectionId);
  return { connectionId, accountId, displayName, accessExpiresAt, refreshExpiresAt };
}`);

source = source.replace(
  'return { workspaceId: state.workspace_id, connectionId: state.connection_id, provider, ...completed };',
  'return { workspaceId: state.workspace_id, connectionId: completed.connectionId, provider, ...completed };',
);

source = source.replace(
`  const prefix = provider === 'youtube' ? 'yt' : 'tk';
  const id = \`\${prefix}:\${crypto.randomUUID()}\`;`,
`  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await db.prepare(
    \`DELETE FROM social_connections
     WHERE workspace_id = ? AND platform = ? AND status = 'pending' AND external_account_id IS NULL
       AND created_at < ?
       AND NOT EXISTS (SELECT 1 FROM oauth_credentials oc WHERE oc.connection_id = social_connections.id)
       AND NOT EXISTS (SELECT 1 FROM content_post_destinations d WHERE d.connection_id = social_connections.id)
       AND NOT EXISTS (SELECT 1 FROM content_post_targets t WHERE t.connection_id = social_connections.id)
       AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.connection_id = social_connections.id)\`,
  ).bind(principal.workspaceId, provider, staleBefore).run();

  const prefix = provider === 'youtube' ? 'yt' : 'tk';
  const id = \`\${prefix}:\${crypto.randomUUID()}\`;`,
);

source = source.replace(
`       AND access_expires_at IS NOT NULL AND access_expires_at > ? AND access_expires_at <= ?
       AND COALESCE(last_refreshed_at, created_at) <= ?
     ORDER BY access_expires_at ASC LIMIT 20\`,
  ).bind(now.toISOString(), threshold, oldEnough).all<RefreshCandidateRow>();`,
`       AND access_expires_at IS NOT NULL AND access_expires_at <= ?
       AND updated_at <= ?
     ORDER BY access_expires_at ASC LIMIT 20\`,
  ).bind(threshold, oldEnough).all<RefreshCandidateRow>();`,
);

source = source.replace(
`      if (await refreshCandidate(db, env, candidate, fetchImpl)) refreshed += 1;
      else failed += 1;`,
`      if (await refreshCandidate(db, env, candidate, fetchImpl)) {
        refreshed += 1;
        await db.prepare("UPDATE social_connections SET status = 'connected', updated_at = ? WHERE workspace_id = ? AND id = ?")
          .bind(new Date().toISOString(), candidate.workspace_id, candidate.connection_id).run();
      } else {
        failed += 1;
        await db.prepare('UPDATE oauth_credentials SET updated_at = ? WHERE workspace_id = ? AND connection_id = ?')
          .bind(new Date().toISOString(), candidate.workspace_id, candidate.connection_id).run();
      }`,
);

source = source.replace(
`    } catch (error) {
      failed += 1;
      console.warn(JSON.stringify({ event: 'social_oauth_refresh_failed', provider: candidate.provider, connectionId: candidate.connection_id, message: error instanceof Error ? error.message : 'unknown' }));`,
`    } catch (error) {
      failed += 1;
      await db.prepare('UPDATE oauth_credentials SET updated_at = ? WHERE workspace_id = ? AND connection_id = ?')
        .bind(new Date().toISOString(), candidate.workspace_id, candidate.connection_id).run().catch(() => undefined);
      console.warn(JSON.stringify({ event: 'social_oauth_refresh_failed', provider: candidate.provider, connectionId: candidate.connection_id, message: error instanceof Error ? error.message : 'unknown' }));`,
);

source += '\n// SOCIAL_OAUTH_PERSISTENCE_V2\n';
fs.writeFileSync(path, source);
console.log('Persistent OAuth refresh and account deduplication applied.');
