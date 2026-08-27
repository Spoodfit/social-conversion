const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type OAuthProvider = 'instagram' | 'youtube' | 'tiktok';
export type TokenKind = 'access' | 'refresh';

interface TokenKeyringDocument {
  active: string;
  keys: Record<string, string>;
}

export interface TokenContext {
  workspaceId: string;
  connectionId: string;
  provider: OAuthProvider;
  kind: TokenKind;
}

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  keyVersion: string;
}

export interface StoredOAuthCredentials {
  id: string;
  workspaceId: string;
  connectionId: string;
  provider: OAuthProvider;
  scopes: string[];
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
  lastRefreshedAt?: string;
  revokedAt?: string;
}

interface CredentialMetadataRow {
  id: string;
  workspace_id: string;
  connection_id: string;
  provider: OAuthProvider;
  scopes_json: string;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
  last_refreshed_at: string | null;
  revoked_at: string | null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function utf8Buffer(value: string): ArrayBuffer {
  return toArrayBuffer(encoder.encode(value));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error('Token encryption keyring contains invalid base64.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function parseScopes(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [];
  } catch {
    return [];
  }
}

function parseKeyring(raw: string): TokenKeyringDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('TOKEN_ENCRYPTION_KEYRING must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('TOKEN_ENCRYPTION_KEYRING must be an object.');
  const candidate = parsed as Partial<TokenKeyringDocument>;
  if (!candidate.active || !/^[A-Za-z0-9._-]{1,64}$/.test(candidate.active)) {
    throw new Error('TOKEN_ENCRYPTION_KEYRING active key version is invalid.');
  }
  if (!candidate.keys || typeof candidate.keys !== 'object') {
    throw new Error('TOKEN_ENCRYPTION_KEYRING keys are missing.');
  }

  const activeKey = candidate.keys[candidate.active];
  if (typeof activeKey !== 'string' || base64ToBytes(activeKey).byteLength !== 32) {
    throw new Error('Active token encryption key must be exactly 32 bytes after base64 decoding.');
  }

  return { active: candidate.active, keys: candidate.keys };
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(base64Key);
  if (bytes.byteLength !== 32) throw new Error('Token encryption key must be 32 bytes.');
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(bytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

function additionalData(context: TokenContext, keyVersion: string): ArrayBuffer {
  return utf8Buffer([
    'neptune-social-conversion',
    keyVersion,
    context.workspaceId,
    context.connectionId,
    context.provider,
    context.kind,
  ].join('\u0000'));
}

export function tokenKeyringSecret(env: Env): string | undefined {
  const value = Reflect.get(env, 'TOKEN_ENCRYPTION_KEYRING');
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function encryptToken(
  rawKeyring: string,
  plaintext: string,
  context: TokenContext,
): Promise<EncryptedToken> {
  if (!plaintext) throw new Error('Refusing to encrypt an empty OAuth token.');
  const keyring = parseKeyring(rawKeyring);
  const rawKey = keyring.keys[keyring.active];
  if (!rawKey) throw new Error('Active token encryption key is missing.');
  const key = await importAesKey(rawKey);
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(ivBytes),
      additionalData: additionalData(context, keyring.active),
      tagLength: 128,
    },
    key,
    utf8Buffer(plaintext),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(ivBytes),
    keyVersion: keyring.active,
  };
}

export async function decryptToken(
  rawKeyring: string,
  encrypted: EncryptedToken,
  context: TokenContext,
): Promise<string> {
  const keyring = parseKeyring(rawKeyring);
  const rawKey = keyring.keys[encrypted.keyVersion];
  if (!rawKey) throw new Error(`Token encryption key version ${encrypted.keyVersion} is unavailable.`);
  const key = await importAesKey(rawKey);
  const ivBytes = base64ToBytes(encrypted.iv);
  if (ivBytes.byteLength !== 12) throw new Error('OAuth token IV must be 12 bytes.');
  const ciphertextBytes = base64ToBytes(encrypted.ciphertext);

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(ivBytes),
        additionalData: additionalData(context, encrypted.keyVersion),
        tagLength: 128,
      },
      key,
      toArrayBuffer(ciphertextBytes),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error('OAuth token decryption failed.');
  }
}

export async function saveOAuthCredentials(
  db: D1Database,
  rawKeyring: string,
  input: {
    workspaceId: string;
    connectionId: string;
    provider: OAuthProvider;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
    accessExpiresAt?: string;
    refreshExpiresAt?: string;
  },
): Promise<StoredOAuthCredentials> {
  const connection = await db
    .prepare(
      `SELECT id, platform
       FROM social_connections
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(input.connectionId, input.workspaceId)
    .first<{ id: string; platform: OAuthProvider }>();

  if (!connection || connection.platform !== input.provider) {
    throw new Error('OAuth credential connection does not belong to this workspace/provider.');
  }

  const access = await encryptToken(rawKeyring, input.accessToken, {
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    provider: input.provider,
    kind: 'access',
  });
  const refresh = input.refreshToken
    ? await encryptToken(rawKeyring, input.refreshToken, {
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      provider: input.provider,
      kind: 'refresh',
    })
    : undefined;

  const now = new Date().toISOString();
  const id = `oauth:${input.connectionId}`;
  const normalizedScopes = input.scopes === undefined
    ? undefined
    : [...new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean))].sort();

  await db
    .prepare(
      `INSERT INTO oauth_credentials
        (id, workspace_id, connection_id, provider,
         access_token_ciphertext, access_token_iv, access_key_version,
         refresh_token_ciphertext, refresh_token_iv, refresh_key_version,
         scopes_json, access_expires_at, refresh_expires_at,
         last_refreshed_at, revoked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(connection_id) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         provider = excluded.provider,
         access_token_ciphertext = excluded.access_token_ciphertext,
         access_token_iv = excluded.access_token_iv,
         access_key_version = excluded.access_key_version,
         refresh_token_ciphertext = COALESCE(excluded.refresh_token_ciphertext, oauth_credentials.refresh_token_ciphertext),
         refresh_token_iv = COALESCE(excluded.refresh_token_iv, oauth_credentials.refresh_token_iv),
         refresh_key_version = COALESCE(excluded.refresh_key_version, oauth_credentials.refresh_key_version),
         scopes_json = CASE WHEN ? = 1 THEN excluded.scopes_json ELSE oauth_credentials.scopes_json END,
         access_expires_at = excluded.access_expires_at,
         refresh_expires_at = COALESCE(excluded.refresh_expires_at, oauth_credentials.refresh_expires_at),
         last_refreshed_at = excluded.last_refreshed_at,
         revoked_at = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      input.workspaceId,
      input.connectionId,
      input.provider,
      access.ciphertext,
      access.iv,
      access.keyVersion,
      refresh?.ciphertext ?? null,
      refresh?.iv ?? null,
      refresh?.keyVersion ?? null,
      JSON.stringify(normalizedScopes ?? []),
      input.accessExpiresAt ?? null,
      input.refreshExpiresAt ?? null,
      now,
      now,
      now,
      normalizedScopes === undefined ? 0 : 1,
    )
    .run();

  const metadata = await db
    .prepare(
      `SELECT id, workspace_id, connection_id, provider, scopes_json,
              access_expires_at, refresh_expires_at, last_refreshed_at, revoked_at
       FROM oauth_credentials
       WHERE workspace_id = ? AND connection_id = ?`,
    )
    .bind(input.workspaceId, input.connectionId)
    .first<CredentialMetadataRow>();

  if (!metadata) throw new Error('OAuth credentials could not be read back after save.');

  return {
    id: metadata.id,
    workspaceId: metadata.workspace_id,
    connectionId: metadata.connection_id,
    provider: metadata.provider,
    scopes: parseScopes(metadata.scopes_json),
    accessExpiresAt: metadata.access_expires_at ?? undefined,
    refreshExpiresAt: metadata.refresh_expires_at ?? undefined,
    lastRefreshedAt: metadata.last_refreshed_at ?? undefined,
    revokedAt: metadata.revoked_at ?? undefined,
  };
}

export async function loadOAuthTokens(
  db: D1Database,
  rawKeyring: string,
  workspaceId: string,
  connectionId: string,
): Promise<{ accessToken: string; refreshToken?: string; credentials: StoredOAuthCredentials } | undefined> {
  const row = await db
    .prepare(
      `SELECT id, workspace_id, connection_id, provider,
              access_token_ciphertext, access_token_iv, access_key_version,
              refresh_token_ciphertext, refresh_token_iv, refresh_key_version,
              scopes_json, access_expires_at, refresh_expires_at,
              last_refreshed_at, revoked_at
       FROM oauth_credentials
       WHERE workspace_id = ? AND connection_id = ?`,
    )
    .bind(workspaceId, connectionId)
    .first<{
      id: string;
      workspace_id: string;
      connection_id: string;
      provider: OAuthProvider;
      access_token_ciphertext: string;
      access_token_iv: string;
      access_key_version: string;
      refresh_token_ciphertext: string | null;
      refresh_token_iv: string | null;
      refresh_key_version: string | null;
      scopes_json: string;
      access_expires_at: string | null;
      refresh_expires_at: string | null;
      last_refreshed_at: string | null;
      revoked_at: string | null;
    }>();

  if (!row || row.revoked_at) return undefined;

  const accessToken = await decryptToken(rawKeyring, {
    ciphertext: row.access_token_ciphertext,
    iv: row.access_token_iv,
    keyVersion: row.access_key_version,
  }, {
    workspaceId,
    connectionId,
    provider: row.provider,
    kind: 'access',
  });

  let refreshToken: string | undefined;
  if (row.refresh_token_ciphertext || row.refresh_token_iv || row.refresh_key_version) {
    if (!row.refresh_token_ciphertext || !row.refresh_token_iv || !row.refresh_key_version) {
      throw new Error('Stored OAuth refresh token metadata is incomplete.');
    }
    refreshToken = await decryptToken(rawKeyring, {
      ciphertext: row.refresh_token_ciphertext,
      iv: row.refresh_token_iv,
      keyVersion: row.refresh_key_version,
    }, {
      workspaceId,
      connectionId,
      provider: row.provider,
      kind: 'refresh',
    });
  }

  return {
    accessToken,
    refreshToken,
    credentials: {
      id: row.id,
      workspaceId: row.workspace_id,
      connectionId: row.connection_id,
      provider: row.provider,
      scopes: parseScopes(row.scopes_json),
      accessExpiresAt: row.access_expires_at ?? undefined,
      refreshExpiresAt: row.refresh_expires_at ?? undefined,
      lastRefreshedAt: row.last_refreshed_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined,
    },
  };
}

export async function revokeOAuthCredentials(
  db: D1Database,
  workspaceId: string,
  connectionId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE oauth_credentials
       SET revoked_at = ?, updated_at = ?
       WHERE workspace_id = ? AND connection_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, now, workspaceId, connectionId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}
