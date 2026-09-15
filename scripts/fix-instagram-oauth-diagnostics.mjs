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

console.log('Instagram OAuth login hardening and safe provider diagnostics applied.');
