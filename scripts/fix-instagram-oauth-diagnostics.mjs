import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Instagram OAuth diagnostics patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// 1) Force the dedicated Instagram Login flow and a fresh authentication.
const instagramPath = 'src/worker/instagram-oauth.ts';
let instagram = fs.readFileSync(instagramPath, 'utf8');
if (!instagram.includes('INSTAGRAM_OAUTH_DIAGNOSTICS_V1')) {
  instagram = replaceOnce(
    instagram,
    `  authorize.searchParams.set('scope', instagramScopes.join(','));\n  authorize.searchParams.set('state', state);`,
    `  authorize.searchParams.set('scope', instagramScopes.join(','));\n  authorize.searchParams.set('state', state);\n  authorize.searchParams.set('enable_fb_login', '0');\n  authorize.searchParams.set('force_authentication', '1');`,
    'Instagram-only authorization parameters',
  );

  // Log only provider error metadata, never tokens or authorization codes.
  instagram = replaceOnce(
    instagram,
    `    if (!response.ok) {\n      console.warn(JSON.stringify({ event: 'instagram_oauth_provider_failed', status: response.status, step: failureCode }));\n      throw new InstagramOAuthError(failureCode, \`Instagram provider request failed with HTTP \${response.status}.\`);\n    }`,
    `    if (!response.ok) {\n      let providerCode: string | number | undefined;\n      let providerSubcode: string | number | undefined;\n      let providerType: string | undefined;\n      try {\n        const failure = await response.clone().json() as { error?: { code?: unknown; error_subcode?: unknown; type?: unknown } };\n        const detail = failure?.error;\n        if (typeof detail?.code === 'string' || typeof detail?.code === 'number') providerCode = detail.code;\n        if (typeof detail?.error_subcode === 'string' || typeof detail?.error_subcode === 'number') providerSubcode = detail.error_subcode;\n        if (typeof detail?.type === 'string') providerType = detail.type.slice(0, 80);\n      } catch {\n        // Provider returned a non-JSON error. Status + step remain enough for safe diagnostics.\n      }\n      console.warn(JSON.stringify({\n        event: 'instagram_oauth_provider_failed',\n        status: response.status,\n        step: failureCode,\n        providerCode,\n        providerSubcode,\n        providerType,\n      }));\n      throw new InstagramOAuthError(failureCode, \`Instagram provider request failed with HTTP \${response.status}.\`);\n    }`,
    'safe provider diagnostics',
  );

  instagram += '\n// INSTAGRAM_OAUTH_DIAGNOSTICS_V1\n';
  fs.writeFileSync(instagramPath, instagram);
}

// 2) Preserve a safe failure code across the OAuth redirect instead of discarding it.
const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
if (!production.includes('INSTAGRAM_OAUTH_REDIRECT_DIAGNOSTICS_V1')) {
  const redirectStart = production.indexOf('function oauthRedirect(');
  const callbackStart = production.indexOf('async function handleInstagramOAuthCallback(', redirectStart);
  if (redirectStart < 0 || callbackStart < 0) throw new Error('Instagram OAuth diagnostics patch failed: redirect/callback boundaries not found.');

  const redirectFn = `function oauthRedirect(env: Env, outcome: 'connected' | 'error', errorCode?: string): string {
  const configured = Reflect.get(env, 'INSTAGRAM_REDIRECT_URI');
  try {
    const base = new URL(typeof configured === 'string' ? configured : 'https://social.neptunebusiness.com/oauth/instagram/callback');
    base.pathname = '/';
    base.search = '';
    base.searchParams.set('oauth', 'instagram-' + outcome);
    if (errorCode) base.searchParams.set('oauth_error', errorCode.slice(0, 80));
    base.hash = '';
    return base.toString();
  } catch {
    const fallback = new URL('https://social.neptunebusiness.com/');
    fallback.searchParams.set('oauth', 'instagram-' + outcome);
    if (errorCode) fallback.searchParams.set('oauth_error', errorCode.slice(0, 80));
    return fallback.toString();
  }
}

`;
  production = production.slice(0, redirectStart) + redirectFn + production.slice(callbackStart);

  production = replaceOnce(
    production,
    `  if (url.searchParams.has('error') || !state || !code) {\n    return Response.redirect(oauthRedirect(env, 'error'), 302);\n  }`,
    `  if (url.searchParams.has('error') || !state || !code) {\n    const providerFailure = url.searchParams.get('error_reason') || url.searchParams.get('error') || 'INVALID_CALLBACK';\n    const safeFailure = providerFailure.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60).toUpperCase();\n    return Response.redirect(oauthRedirect(env, 'error', 'PROVIDER_' + safeFailure), 302);\n  }`,
    'provider callback failure code',
  );

  production = replaceOnce(
    production,
    `        location: oauthRedirect(env, 'error'),`,
    `        location: oauthRedirect(env, 'error', error instanceof InstagramOAuthError ? error.code : 'UNKNOWN'),`,
    'internal callback failure code',
  );

  production += '\n// INSTAGRAM_OAUTH_REDIRECT_DIAGNOSTICS_V1\n';
  fs.writeFileSync(productionPath, production);
}

// 3) Show the actionable reason in the UI after returning from Instagram.
const livePath = 'src/LiveAppV3.tsx';
let live = fs.readFileSync(livePath, 'utf8');
if (!live.includes('SC_INSTAGRAM_OAUTH_FEEDBACK_V1')) {
  const oauthEffect = live.indexOf("const oauth = current.searchParams.get('oauth');");
  const feedbackStart = live.indexOf('    const platform = match[1] as SocialPlatform;', oauthEffect);
  const deleteMarker = "    current.searchParams.delete('oauth');";
  const feedbackEnd = live.indexOf(deleteMarker, feedbackStart);
  if (oauthEffect < 0 || feedbackStart < 0 || feedbackEnd < 0) {
    throw new Error('Instagram OAuth diagnostics patch failed: OAuth callback UI feedback boundaries not found.');
  }

  const feedback = `    const platform = match[1] as SocialPlatform;
    const outcome = match[2];
    const oauthError = current.searchParams.get('oauth_error') || '';
    const oauthErrorMessage: Record<string, string> = {
      PROVIDER_ACCESS_DENIED: 'L’autorisation a été refusée dans Instagram.',
      PROVIDER_USER_DENIED: 'L’autorisation a été refusée dans Instagram.',
      PROVIDER_INVALID_CALLBACK: 'Instagram n’a pas renvoyé une autorisation complète.',
      OAUTH_STATE_EXPIRED: 'La tentative de connexion a expiré. Relancez la connexion.',
      INVALID_OAUTH_STATE: 'La tentative de connexion n’est plus valide. Relancez la connexion.',
      CONNECTION_NOT_FOUND: 'La connexion temporaire n’existe plus. Relancez la connexion.',
      OAUTH_PROVIDER_FAILED: 'Instagram a refusé une étape de l’autorisation ou de l’échange de jeton.',
      OAUTH_PROFILE_INVALID: 'Instagram n’a pas pu valider ce compte professionnel.',
      OAUTH_NOT_CONFIGURED: 'La configuration Instagram du serveur est incomplète.',
      UNKNOWN: 'Une erreur interne est survenue pendant la connexion.',
    };
    setToast(outcome === 'connected'
      ? platformLabel(platform) + ' est connecté.'
      : (oauthErrorMessage[oauthError] || ('La connexion ' + platformLabel(platform) + ' n’a pas abouti.')) + (oauthError ? ' [' + oauthError + ']' : ''));
    current.searchParams.delete('oauth');
    current.searchParams.delete('oauth_error');`;

  live = live.slice(0, feedbackStart) + feedback + live.slice(feedbackEnd + deleteMarker.length);
  live += '\n/* SC_INSTAGRAM_OAUTH_FEEDBACK_V1 */\n';
  fs.writeFileSync(livePath, live);
}

console.log('Instagram OAuth login hardening and actionable diagnostics applied.');
