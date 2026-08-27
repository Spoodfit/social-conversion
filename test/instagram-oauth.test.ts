import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspacePrincipal } from '../src/worker/authorization';
import {
  completeInstagramOAuth,
  refreshExpiringInstagramTokens,
  startInstagramOAuth,
} from '../src/worker/instagram-oauth';
import { loadOAuthTokens } from '../src/worker/token-vault';

function base64Key(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function keyring() {
  return JSON.stringify({ active: 'oauth-v1', keys: { 'oauth-v1': base64Key(53) } });
}

function oauthEnv(): Env {
  return {
    ...env,
    META_GRAPH_VERSION: 'v24.0',
    TOKEN_ENCRYPTION_KEYRING: keyring(),
    INSTAGRAM_APP_ID: '123456789012345',
    INSTAGRAM_APP_SECRET: 'instagram-test-app-secret-never-store',
    INSTAGRAM_REDIRECT_URI: 'https://social-conversion.neptunebusiness.com/oauth/instagram/callback',
  } as unknown as Env;
}

async function principal(): Promise<WorkspacePrincipal> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO workspace_members
      (id, workspace_id, access_subject, email, role, status, activated_at, created_at, updated_at)
     VALUES ('oauth-member', 'default', 'oauth-subject', 'oauth@example.test', 'admin', 'active',
             '2026-08-27T15:00:00.000Z', '2026-08-27T15:00:00.000Z', '2026-08-27T15:00:00.000Z')`,
  ).run();
  return {
    subject: 'oauth-subject',
    email: 'oauth@example.test',
    workspaceId: 'default',
    workspaceName: 'Neptune Business Club',
    role: 'admin',
    memberId: 'oauth-member',
  };
}

function oauthFetch() {
  let call = 0;
  return vi.fn<typeof fetch>(async (input, init) => {
    call += 1;
    const url = String(input);
    if (call === 1) {
      expect(url).toBe('https://api.instagram.com/oauth/access_token');
      expect(init?.method).toBe('POST');
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('client_secret')).toBe('instagram-test-app-secret-never-store');
      expect(form.get('code')).toBe('oauth-code-test');
      return Response.json({ access_token: 'IGAA-short-secret', user_id: 17890001234567890 });
    }
    if (call === 2) {
      expect(url).toContain('https://graph.instagram.com/access_token?');
      const parsed = new URL(url);
      expect(parsed.searchParams.get('grant_type')).toBe('ig_exchange_token');
      expect(parsed.searchParams.get('access_token')).toBe('IGAA-short-secret');
      return Response.json({ access_token: 'IGAA-long-secret-never-store-plaintext', expires_in: 5_184_000 });
    }
    if (call === 3) {
      expect(url).toBe('https://graph.instagram.com/v24.0/me?fields=user_id,username');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer IGAA-long-secret-never-store-plaintext');
      return Response.json({ user_id: '17890001234567890', username: 'neptune_test' });
    }
    if (call === 4) {
      expect(url).toBe('https://graph.instagram.com/v24.0/17890001234567890/subscribed_apps');
      const body = JSON.parse(String(init?.body)) as { subscribed_fields: string[] };
      expect(body.subscribed_fields).toEqual(['messages', 'messaging_postbacks', 'comments']);
      return Response.json({ success: true });
    }
    throw new Error(`unexpected provider call ${call}`);
  });
}

describe('Instagram Business Login OAuth', () => {
  it('creates a one-time state, exchanges tokens, subscribes webhooks and stores only ciphertext', async () => {
    const actor = await principal();
    const started = await startInstagramOAuth(env.DB, oauthEnv(), actor);
    const authUrl = new URL(started.url);
    expect(authUrl.origin).toBe('https://www.instagram.com');
    expect(authUrl.pathname).toBe('/oauth/authorize');
    expect(authUrl.searchParams.get('client_id')).toBe('123456789012345');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://social-conversion.neptunebusiness.com/oauth/instagram/callback');
    expect(authUrl.searchParams.get('scope')).toContain('instagram_business_manage_messages');
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const fetchMock = oauthFetch();
    const completed = await completeInstagramOAuth(env.DB, oauthEnv(), {
      state: String(state),
      code: 'oauth-code-test',
    }, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(completed).toMatchObject({
      connectionId: started.connectionId,
      accountId: '17890001234567890',
      username: 'neptune_test',
    });

    const connection = await env.DB.prepare(
      `SELECT external_account_id, display_name, handle, status, capabilities_json
       FROM social_connections WHERE id = ? AND workspace_id = 'default'`,
    ).bind(started.connectionId).first<{
      external_account_id: string;
      display_name: string;
      handle: string;
      status: string;
      capabilities_json: string;
    }>();
    expect(connection).toMatchObject({
      external_account_id: '17890001234567890',
      handle: '@neptune_test',
      status: 'connected',
    });
    expect(JSON.parse(connection?.capabilities_json ?? '{}')).toMatchObject({ direct_messages: true, comments: true });

    const stored = await env.DB.prepare(
      `SELECT access_token_ciphertext, scopes_json, revoked_at FROM oauth_credentials WHERE connection_id = ?`,
    ).bind(started.connectionId).first<{ access_token_ciphertext: string; scopes_json: string; revoked_at: string | null }>();
    expect(stored?.access_token_ciphertext).not.toContain('IGAA-long-secret-never-store-plaintext');
    expect(JSON.parse(stored?.scopes_json ?? '[]')).toContain('instagram_business_manage_messages');
    expect(stored?.revoked_at).toBeNull();

    const loaded = await loadOAuthTokens(env.DB, keyring(), 'default', started.connectionId);
    expect(loaded?.accessToken).toBe('IGAA-long-secret-never-store-plaintext');

    const secondFetch = vi.fn<typeof fetch>();
    await expect(completeInstagramOAuth(env.DB, oauthEnv(), {
      state: String(state),
      code: 'oauth-code-test',
    }, secondFetch)).rejects.toMatchObject({ code: 'INVALID_OAUTH_STATE' });
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('fails closed if webhook subscription is not confirmed', async () => {
    const actor = await principal();
    const started = await startInstagramOAuth(env.DB, oauthEnv(), actor);
    const state = new URL(started.url).searchParams.get('state') ?? '';
    const baseFetch = oauthFetch();
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      call += 1;
      if (call < 4) return baseFetch(input, init);
      return Response.json({ success: false });
    });

    await expect(completeInstagramOAuth(env.DB, oauthEnv(), {
      state,
      code: 'oauth-code-test',
    }, fetchMock)).rejects.toMatchObject({ code: 'OAUTH_WEBHOOK_SUBSCRIPTION_FAILED' });
    const connection = await env.DB.prepare(
      'SELECT status FROM social_connections WHERE id = ?',
    ).bind(started.connectionId).first<{ status: string }>();
    expect(connection?.status).toBe('pending');
    const credential = await env.DB.prepare(
      'SELECT id FROM oauth_credentials WHERE connection_id = ?',
    ).bind(started.connectionId).first<{ id: string }>();
    expect(credential).toBeNull();
  });

  it('refreshes encrypted long-lived tokens near expiry without storing plaintext', async () => {
    const actor = await principal();
    const started = await startInstagramOAuth(env.DB, oauthEnv(), actor);
    const state = new URL(started.url).searchParams.get('state') ?? '';
    await completeInstagramOAuth(env.DB, oauthEnv(), { state, code: 'oauth-code-test' }, oauthFetch());
    await env.DB.prepare(
      `UPDATE oauth_credentials
       SET access_expires_at = '2026-08-30T12:00:00.000Z',
           last_refreshed_at = '2026-08-25T12:00:00.000Z'
       WHERE connection_id = ?`,
    ).bind(started.connectionId).run();

    const refreshFetch = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://graph.instagram.com/refresh_access_token');
      expect(url.searchParams.get('grant_type')).toBe('ig_refresh_token');
      expect(url.searchParams.get('access_token')).toBe('IGAA-long-secret-never-store-plaintext');
      return Response.json({ access_token: 'IGAA-refreshed-secret', expires_in: 5_184_000 });
    });
    const result = await refreshExpiringInstagramTokens(env.DB, oauthEnv(), refreshFetch);
    expect(result).toEqual({ refreshed: 1, failed: 0 });
    const loaded = await loadOAuthTokens(env.DB, keyring(), 'default', started.connectionId);
    expect(loaded?.accessToken).toBe('IGAA-refreshed-secret');
    const row = await env.DB.prepare(
      'SELECT access_token_ciphertext FROM oauth_credentials WHERE connection_id = ?',
    ).bind(started.connectionId).first<{ access_token_ciphertext: string }>();
    expect(row?.access_token_ciphertext).not.toContain('IGAA-refreshed-secret');
  });
});
