import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspacePrincipal } from '../src/worker/authorization';
import {
  completeSocialOAuth,
  socialOAuthConfigured,
  startSocialOAuth,
} from '../src/worker/social-account-oauth';
import { loadOAuthTokens } from '../src/worker/token-vault';

function base64Key(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function keyring() {
  return JSON.stringify({ active: 'oauth-v1', keys: { 'oauth-v1': base64Key(71) } });
}

function oauthEnv(): Env {
  return {
    ...env,
    TOKEN_ENCRYPTION_KEYRING: keyring(),
    YOUTUBE_CLIENT_ID: 'youtube-client-id.apps.googleusercontent.com',
    YOUTUBE_CLIENT_SECRET: 'youtube-client-secret-never-store',
    YOUTUBE_REDIRECT_URI: 'https://social.neptunebusiness.com/oauth/youtube/callback',
    TIKTOK_CLIENT_KEY: 'tiktok-client-key',
    TIKTOK_CLIENT_SECRET: 'tiktok-client-secret-never-store',
    TIKTOK_REDIRECT_URI: 'https://social.neptunebusiness.com/oauth/tiktok/callback',
  } as unknown as Env;
}

async function principal(): Promise<WorkspacePrincipal> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace_members
      (id, workspace_id, access_subject, email, role, status, activated_at, created_at, updated_at)
     VALUES ('social-oauth-member', 'default', 'social-oauth-subject', 'social-oauth@example.test', 'admin', 'active',
             '2026-09-14T15:00:00.000Z', '2026-09-14T15:00:00.000Z', '2026-09-14T15:00:00.000Z')`,
  ).run();
  return {
    subject: 'social-oauth-subject',
    email: 'social-oauth@example.test',
    workspaceId: 'default',
    workspaceName: 'Neptune Business Club',
    role: 'admin',
    memberId: 'social-oauth-member',
  };
}

describe('multi-provider social OAuth', () => {
  it('connects a YouTube channel and encrypts durable credentials', async () => {
    const actor = await principal();
    const configured = oauthEnv();
    expect(socialOAuthConfigured(configured, 'youtube')).toBe(true);

    const started = await startSocialOAuth(env.DB, configured, actor, 'youtube');
    const auth = new URL(started.url);
    expect(auth.origin).toBe('https://accounts.google.com');
    expect(auth.pathname).toBe('/o/oauth2/v2/auth');
    expect(auth.searchParams.get('client_id')).toBe('youtube-client-id.apps.googleusercontent.com');
    expect(auth.searchParams.get('access_type')).toBe('offline');
    expect(auth.searchParams.get('scope')).toContain('youtube.upload');
    const state = auth.searchParams.get('state') ?? '';
    expect(state).toBeTruthy();

    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      call += 1;
      if (call === 1) {
        expect(String(input)).toBe('https://oauth2.googleapis.com/token');
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('code')).toBe('youtube-code');
        expect(form.get('client_secret')).toBe('youtube-client-secret-never-store');
        return Response.json({
          access_token: 'youtube-access-secret-never-store',
          refresh_token: 'youtube-refresh-secret-never-store',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl',
        });
      }
      if (call === 2) {
        expect(String(input)).toBe('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true');
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer youtube-access-secret-never-store');
        return Response.json({ items: [{ id: 'UCNeptune123456', snippet: { title: 'Neptune Business', customUrl: '@neptunebusiness' } }] });
      }
      throw new Error(`unexpected YouTube call ${call}`);
    });

    const completed = await completeSocialOAuth(env.DB, configured, 'youtube', { state, code: 'youtube-code' }, fetchMock);
    expect(completed).toMatchObject({ connectionId: started.connectionId, accountId: 'UCNeptune123456', displayName: 'Neptune Business' });
    const connection = await env.DB.prepare(
      `SELECT platform, external_account_id, display_name, handle, status, capabilities_json
       FROM social_connections WHERE id = ?`,
    ).bind(started.connectionId).first<{ platform: string; external_account_id: string; display_name: string; handle: string; status: string; capabilities_json: string }>();
    expect(connection).toMatchObject({ platform: 'youtube', external_account_id: 'UCNeptune123456', display_name: 'YouTube · Neptune Business', handle: '@neptunebusiness', status: 'connected' });
    expect(JSON.parse(connection?.capabilities_json ?? '{}')).toMatchObject({ comments: true, publishing: true, direct_messages: false });

    const loaded = await loadOAuthTokens(env.DB, keyring(), 'default', started.connectionId);
    expect(loaded?.accessToken).toBe('youtube-access-secret-never-store');
    expect(loaded?.refreshToken).toBe('youtube-refresh-secret-never-store');
    const stored = await env.DB.prepare(
      `SELECT access_token_ciphertext, refresh_token_ciphertext FROM oauth_credentials WHERE connection_id = ?`,
    ).bind(started.connectionId).first<{ access_token_ciphertext: string; refresh_token_ciphertext: string }>();
    expect(stored?.access_token_ciphertext).not.toContain('youtube-access-secret-never-store');
    expect(stored?.refresh_token_ciphertext).not.toContain('youtube-refresh-secret-never-store');
  });

  it('connects a TikTok account with basic profile permission and keeps publishing fail-closed', async () => {
    const actor = await principal();
    const configured = oauthEnv();
    expect(socialOAuthConfigured(configured, 'tiktok')).toBe(true);

    const started = await startSocialOAuth(env.DB, configured, actor, 'tiktok');
    const auth = new URL(started.url);
    expect(auth.origin).toBe('https://www.tiktok.com');
    expect(auth.pathname).toBe('/v2/auth/authorize/');
    expect(auth.searchParams.get('client_key')).toBe('tiktok-client-key');
    expect(auth.searchParams.get('scope')).toBe('user.info.basic');
    const state = auth.searchParams.get('state') ?? '';

    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      call += 1;
      if (call === 1) {
        expect(String(input)).toBe('https://open.tiktokapis.com/v2/oauth/token/');
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('code')).toBe('tiktok-code');
        expect(form.get('client_secret')).toBe('tiktok-client-secret-never-store');
        return Response.json({
          access_token: 'tiktok-access-secret-never-store',
          refresh_token: 'tiktok-refresh-secret-never-store',
          expires_in: 86400,
          refresh_expires_in: 31_536_000,
          open_id: 'tiktok-open-id-123',
          scope: 'user.info.basic',
        });
      }
      if (call === 2) {
        expect(String(input)).toContain('https://open.tiktokapis.com/v2/user/info/');
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tiktok-access-secret-never-store');
        return Response.json({ data: { user: { open_id: 'tiktok-open-id-123', display_name: 'Neptune TikTok' } } });
      }
      throw new Error(`unexpected TikTok call ${call}`);
    });

    const completed = await completeSocialOAuth(env.DB, configured, 'tiktok', { state, code: 'tiktok-code' }, fetchMock);
    expect(completed).toMatchObject({ connectionId: started.connectionId, accountId: 'tiktok-open-id-123', displayName: 'Neptune TikTok' });
    const connection = await env.DB.prepare(
      `SELECT platform, external_account_id, display_name, status, capabilities_json
       FROM social_connections WHERE id = ?`,
    ).bind(started.connectionId).first<{ platform: string; external_account_id: string; display_name: string; status: string; capabilities_json: string }>();
    expect(connection).toMatchObject({ platform: 'tiktok', external_account_id: 'tiktok-open-id-123', display_name: 'TikTok · Neptune TikTok', status: 'connected' });
    expect(JSON.parse(connection?.capabilities_json ?? '{}')).toMatchObject({ publishing: false, upload: false, direct_messages: false });

    const loaded = await loadOAuthTokens(env.DB, keyring(), 'default', started.connectionId);
    expect(loaded?.accessToken).toBe('tiktok-access-secret-never-store');
    expect(loaded?.refreshToken).toBe('tiktok-refresh-secret-never-store');
  });

  it('fails closed when provider credentials are absent', async () => {
    const actor = await principal();
    const missing = { ...env, TOKEN_ENCRYPTION_KEYRING: keyring() } as unknown as Env;
    expect(socialOAuthConfigured(missing, 'youtube')).toBe(false);
    await expect(startSocialOAuth(env.DB, missing, actor, 'youtube')).rejects.toMatchObject({ code: 'OAUTH_NOT_CONFIGURED' });
  });
});
