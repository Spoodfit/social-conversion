import fs from 'node:fs';

const path = 'src/worker/production.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes("from './social-account-oauth'")) {
  console.log('Multi-provider social OAuth already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Social OAuth patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

replaceOnce(
`import {
  completeInstagramOAuth,
  InstagramOAuthError,
  instagramOAuthConfigured,
  refreshExpiringInstagramTokens,
  startInstagramOAuth,
} from './instagram-oauth';`,
`import {
  completeInstagramOAuth,
  InstagramOAuthError,
  instagramOAuthConfigured,
  refreshExpiringInstagramTokens,
  startInstagramOAuth,
} from './instagram-oauth';
import {
  completeSocialOAuth,
  refreshExpiringSocialTokens,
  socialOAuthConfigured,
  SocialOAuthError,
  startSocialOAuth,
  type SocialOAuthProvider,
} from './social-account-oauth';`,
  'social OAuth import',
);

replaceOnce(
`async function dispatchPending(env: Env): Promise<number> {`,
`function socialOauthErrorResponse(error: SocialOAuthError): Response {
  if (error.code === 'OAUTH_NOT_CONFIGURED') return Response.json({ error: error.message, code: error.code }, { status: 503 });
  if (error.code === 'CONNECTION_NOT_FOUND') return Response.json({ error: error.message, code: error.code }, { status: 404 });
  if (error.code === 'CONNECTION_ALREADY_CONNECTED') return Response.json({ error: error.message, code: error.code }, { status: 409 });
  if (error.code === 'INVALID_OAUTH_STATE' || error.code === 'OAUTH_STATE_EXPIRED') {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  return Response.json({ error: error.message, code: error.code }, { status: 502 });
}

async function handleSocialOAuthStart(request: Request, env: Env, provider: SocialOAuthProvider): Promise<Response> {
  const path = '/api/oauth/' + provider + '/start';
  const auth = await authenticateMutation(request, env, path);
  if (!auth.ok) return auth.response;
  if (auth.principal.role !== 'admin' && auth.principal.role !== 'manager') {
    return Response.json({ error: 'Only workspace administrators or managers can connect social accounts.', code: 'ROLE_FORBIDDEN' }, { status: 403 });
  }
  if (env.DEMO_MODE === 'true') {
    return Response.json({ error: 'Social OAuth is disabled in demo mode.', code: 'LIVE_NOT_READY' }, { status: 503 });
  }
  const body = await request.json().catch(() => undefined) as { connectionId?: unknown } | undefined;
  const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : undefined;
  try {
    return Response.json(await startSocialOAuth(env.DB, env, auth.principal, provider, connectionId), { status: 201 });
  } catch (error) {
    if (error instanceof SocialOAuthError) return socialOauthErrorResponse(error);
    throw error;
  }
}

function socialOauthRedirect(env: Env, provider: SocialOAuthProvider, outcome: 'connected' | 'error'): string {
  const key = provider === 'youtube' ? 'YOUTUBE_REDIRECT_URI' : 'TIKTOK_REDIRECT_URI';
  const configured = Reflect.get(env, key);
  try {
    const base = new URL(typeof configured === 'string' ? configured : 'https://social.neptunebusiness.com/');
    base.pathname = '/';
    base.search = '?oauth=' + provider + '-' + outcome;
    base.hash = '';
    return base.toString();
  } catch {
    return 'https://social.neptunebusiness.com/?oauth=' + provider + '-' + outcome;
  }
}

async function handleSocialOAuthCallback(url: URL, env: Env, provider: SocialOAuthProvider): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (url.searchParams.has('error') || !state || !code) {
    return Response.redirect(socialOauthRedirect(env, provider, 'error'), 302);
  }
  try {
    await completeSocialOAuth(env.DB, env, provider, { state, code });
    return new Response(null, {
      status: 302,
      headers: {
        location: socialOauthRedirect(env, provider, 'connected'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'social_oauth_callback_failed',
      provider,
      code: error instanceof SocialOAuthError ? error.code : 'unknown',
    }));
    return new Response(null, {
      status: 302,
      headers: {
        location: socialOauthRedirect(env, provider, 'error'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  }
}

async function dispatchPending(env: Env): Promise<number> {`,
  'social OAuth handlers',
);

replaceOnce(
`    if (url.pathname === '/api/oauth/instagram/start' && request.method === 'POST') {
      return handleInstagramOAuthStart(request, env);
    }
    if (url.pathname === '/oauth/instagram/callback' && request.method === 'GET') {
      return handleInstagramOAuthCallback(url, env);
    }`,
`    if (url.pathname === '/api/oauth/instagram/start' && request.method === 'POST') {
      return handleInstagramOAuthStart(request, env);
    }
    const socialStart = url.pathname.match(/^\\/api\\/oauth\\/(youtube|tiktok)\\/start$/);
    if (socialStart && request.method === 'POST') {
      return handleSocialOAuthStart(request, env, socialStart[1] as SocialOAuthProvider);
    }
    if (url.pathname === '/oauth/instagram/callback' && request.method === 'GET') {
      return handleInstagramOAuthCallback(url, env);
    }
    const socialCallback = url.pathname.match(/^\\/oauth\\/(youtube|tiktok)\\/callback$/);
    if (socialCallback && request.method === 'GET') {
      return handleSocialOAuthCallback(url, env, socialCallback[1] as SocialOAuthProvider);
    }`,
  'social OAuth routes',
);

replaceOnce(
`          instagramOAuthReady: env.DEMO_MODE !== 'true' && instagramOAuthConfigured(env),`,
`          instagramOAuthReady: env.DEMO_MODE !== 'true' && instagramOAuthConfigured(env),
          youtubeOAuthReady: env.DEMO_MODE !== 'true' && socialOAuthConfigured(env, 'youtube'),
          tiktokOAuthReady: env.DEMO_MODE !== 'true' && socialOAuthConfigured(env, 'tiktok'),`,
  'runtime readiness',
);

replaceOnce(
`    try {
      await dispatchPending(env);`,
`    try {
      const refresh = await refreshExpiringSocialTokens(env.DB, env);
      if (refresh.refreshed > 0 || refresh.failed > 0) {
        console.log(JSON.stringify({ event: 'social_oauth_refresh_sweep', ...refresh }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: 'social_oauth_refresh_sweep_failed',
        message: error instanceof Error ? error.message : 'unknown',
      }));
    }

    try {
      await dispatchPending(env);`,
  'scheduled social token refresh',
);

source = source.replaceAll('https://social-conversion.neptunebusiness.com/', 'https://social.neptunebusiness.com/');
fs.writeFileSync(path, source);
console.log('YouTube and TikTok OAuth routes applied.');
