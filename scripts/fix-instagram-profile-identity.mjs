import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Instagram profile identity patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const workerPath = 'src/worker/instagram-oauth.ts';
let worker = fs.readFileSync(workerPath, 'utf8');

const originalProfileBlock = `  const profilePayload = await fetchJson(\n    fetchImpl,\n    \`https://graph.instagram.com/\${config.version}/me?fields=user_id,username\`,\n    { method: 'GET', headers: { authorization: \`Bearer \${longPayload.access_token}\` } },\n    'OAUTH_PROFILE_INVALID',\n  ) as ProfileResponse;\n  const profileId = typeof profilePayload.user_id === 'string' || typeof profilePayload.user_id === 'number'\n    ? String(profilePayload.user_id)\n    : typeof profilePayload.id === 'string' || typeof profilePayload.id === 'number'\n      ? String(profilePayload.id)\n      : typeof shortPayload.user_id === 'string' || typeof shortPayload.user_id === 'number'\n        ? String(shortPayload.user_id)\n        : undefined;\n  const username = typeof profilePayload.username === 'string' ? profilePayload.username.trim() : '';\n  if (!profileId || !/^\\d{3,40}$/.test(profileId) || !username || username.length > 100) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram professional account profile could not be validated.');\n  }\n  if (shortPayload.user_id !== undefined && String(shortPayload.user_id) !== profileId) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram token identity does not match the returned professional account.');\n  }`;

const v1ProfileBlock = `  const loginScopedId = typeof shortPayload.user_id === 'string' || typeof shortPayload.user_id === 'number'\n    ? String(shortPayload.user_id)\n    : undefined;\n  if (loginScopedId && !/^\\d{3,40}$/.test(loginScopedId)) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram returned an invalid OAuth user identifier.');\n  }\n\n  const profileFields = 'id,user_id,username';\n  let profilePayload: ProfileResponse;\n  if (loginScopedId) {\n    try {\n      profilePayload = await fetchJson(\n        fetchImpl,\n        \`https://graph.instagram.com/\${config.version}/\${encodeURIComponent(loginScopedId)}?fields=\${profileFields}\`,\n        { method: 'GET', headers: { authorization: \`Bearer \${longPayload.access_token}\` } },\n        'OAUTH_PROFILE_INVALID',\n      ) as ProfileResponse;\n    } catch (error) {\n      if (!(error instanceof InstagramOAuthError) || error.code !== 'OAUTH_PROFILE_INVALID') throw error;\n      profilePayload = await fetchJson(\n        fetchImpl,\n        \`https://graph.instagram.com/\${config.version}/me?fields=\${profileFields}\`,\n        { method: 'GET', headers: { authorization: \`Bearer \${longPayload.access_token}\` } },\n        'OAUTH_PROFILE_INVALID',\n      ) as ProfileResponse;\n    }\n  } else {\n    profilePayload = await fetchJson(\n      fetchImpl,\n      \`https://graph.instagram.com/\${config.version}/me?fields=\${profileFields}\`,\n      { method: 'GET', headers: { authorization: \`Bearer \${longPayload.access_token}\` } },\n      'OAUTH_PROFILE_INVALID',\n    ) as ProfileResponse;\n  }\n\n  const profileScopedId = typeof profilePayload.id === 'string' || typeof profilePayload.id === 'number'\n    ? String(profilePayload.id)\n    : undefined;\n  if (profileScopedId && !/^\\d{3,40}$/.test(profileScopedId)) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram returned an invalid scoped profile identifier.');\n  }\n  if (loginScopedId && profileScopedId && loginScopedId !== profileScopedId) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram OAuth identity does not match the returned profile.');\n  }\n\n  const profileId = typeof profilePayload.user_id === 'string' || typeof profilePayload.user_id === 'number'\n    ? String(profilePayload.user_id)\n    : profileScopedId ?? loginScopedId;\n  const username = typeof profilePayload.username === 'string' ? profilePayload.username.trim() : '';\n  if (!profileId || !/^\\d{3,40}$/.test(profileId) || !username || username.length > 100) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram professional account profile could not be validated.');\n  }`;

const v2ProfileBlock = `  const oauthUserId = typeof shortPayload.user_id === 'string' || typeof shortPayload.user_id === 'number'\n    ? String(shortPayload.user_id)\n    : undefined;\n  if (oauthUserId && !/^\\d{3,40}$/.test(oauthUserId)) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram returned an invalid OAuth user identifier.');\n  }\n\n  // For Instagram Login, /me is the canonical profile endpoint. The returned \"id\" can be\n  // app-scoped while \"user_id\" is the professional Instagram account id used by publishing,\n  // messaging and webhook endpoints. They are intentionally not required to match.\n  const profilePayload = await fetchJson(\n    fetchImpl,\n    \`https://graph.instagram.com/\${config.version}/me?fields=id,user_id,username\`,\n    { method: 'GET', headers: { authorization: \`Bearer \${longPayload.access_token}\` } },\n    'OAUTH_PROFILE_INVALID',\n  ) as ProfileResponse;\n\n  const appScopedId = typeof profilePayload.id === 'string' || typeof profilePayload.id === 'number'\n    ? String(profilePayload.id)\n    : undefined;\n  if (appScopedId && !/^\\d{3,40}$/.test(appScopedId)) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram returned an invalid scoped profile identifier.');\n  }\n\n  const professionalId = typeof profilePayload.user_id === 'string' || typeof profilePayload.user_id === 'number'\n    ? String(profilePayload.user_id)\n    : oauthUserId ?? appScopedId;\n  const username = typeof profilePayload.username === 'string' ? profilePayload.username.trim() : '';\n  if (!professionalId || !/^\\d{3,40}$/.test(professionalId) || !username || username.length > 100) {\n    throw new InstagramOAuthError('OAUTH_PROFILE_INVALID', 'Instagram professional account profile could not be validated.');\n  }\n\n  const profileId = professionalId;`;

if (!worker.includes('INSTAGRAM_PROFILE_IDENTITY_FIX_V2')) {
  if (worker.includes(v1ProfileBlock)) {
    worker = worker.replace(v1ProfileBlock, v2ProfileBlock);
  } else {
    worker = replaceOnce(worker, originalProfileBlock, v2ProfileBlock, 'profile validation');
  }
  worker += '\n// INSTAGRAM_PROFILE_IDENTITY_FIX_V2\n';
  fs.writeFileSync(workerPath, worker);
}

const testPath = 'test/instagram-oauth.test.ts';
let test = fs.readFileSync(testPath, 'utf8');
if (!test.includes('INSTAGRAM_PROFILE_IDENTITY_TEST_V2')) {
  if (test.includes(`function oauthFetch(accountId: string, username: string, suffix: string) {`)) {
    test = test.replace(
      `function oauthFetch(accountId: string, username: string, suffix: string) {`,
      `function oauthFetch(accountId: string, username: string, suffix: string, appScopedId = '990001234567890') {`,
    );
  } else if (test.includes(`function oauthFetch(accountId: string, username: string, suffix: string, loginScopedId = accountId) {`)) {
    test = test.replace(
      `function oauthFetch(accountId: string, username: string, suffix: string, loginScopedId = accountId) {`,
      `function oauthFetch(accountId: string, username: string, suffix: string, appScopedId = '990001234567890') {`,
    );
  }

  test = test.replace(
    `      return Response.json({ access_token: shortToken, user_id: loginScopedId });`,
    `      return Response.json({ access_token: shortToken, user_id: accountId });`,
  );

  const originalProfileExpectation = `      expect(url).toBe('https://graph.instagram.com/v24.0/me?fields=user_id,username');\n      expect((init?.headers as Record<string, string>).authorization).toBe(\`Bearer \${longToken}\`);\n      return Response.json({ user_id: accountId, username });`;
  const v1ProfileExpectation = `      expect(url).toBe(\`https://graph.instagram.com/v24.0/\${loginScopedId}?fields=id,user_id,username\`);\n      expect((init?.headers as Record<string, string>).authorization).toBe(\`Bearer \${longToken}\`);\n      return Response.json({ id: loginScopedId, user_id: accountId, username });`;
  const v2ProfileExpectation = `      expect(url).toBe('https://graph.instagram.com/v24.0/me?fields=id,user_id,username');\n      expect((init?.headers as Record<string, string>).authorization).toBe(\`Bearer \${longToken}\`);\n      return Response.json({ id: appScopedId, user_id: accountId, username });`;

  if (test.includes(v1ProfileExpectation)) {
    test = test.replace(v1ProfileExpectation, v2ProfileExpectation);
  } else {
    test = replaceOnce(test, originalProfileExpectation, v2ProfileExpectation, 'profile request test');
  }

  test = test.replace(
    `    const fetchMock = oauthFetch('17890001234567890', 'neptune_test', 'first', '990001234567890');`,
    `    const fetchMock = oauthFetch('17890001234567890', 'neptune_test', 'first', '990001234567890');`,
  );

  test += '\n// INSTAGRAM_PROFILE_IDENTITY_TEST_V2\n';
  fs.writeFileSync(testPath, test);
}

console.log('Instagram OAuth now uses /me and keeps app-scoped id separate from professional user_id.');
