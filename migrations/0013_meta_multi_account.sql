PRAGMA defer_foreign_keys = ON;

CREATE TABLE social_connections_next (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'youtube', 'tiktok')),
  external_account_id TEXT,
  display_name TEXT NOT NULL,
  handle TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  token_reference TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO social_connections_next
  (id, workspace_id, platform, external_account_id, display_name, handle, status, capabilities_json,
   token_reference, last_synced_at, created_at, updated_at)
SELECT id, workspace_id, platform, external_account_id, display_name, handle, status, capabilities_json,
       token_reference, last_synced_at, created_at, updated_at
FROM social_connections;

DROP TABLE social_connections;
ALTER TABLE social_connections_next RENAME TO social_connections;

CREATE TABLE oauth_credentials_next (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connection_id TEXT NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('instagram', 'facebook', 'youtube', 'tiktok')),
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  access_key_version TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_iv TEXT,
  refresh_key_version TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  access_expires_at TEXT,
  refresh_expires_at TEXT,
  last_refreshed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (connection_id)
);

INSERT INTO oauth_credentials_next
  (id, workspace_id, connection_id, provider, access_token_ciphertext, access_token_iv, access_key_version,
   refresh_token_ciphertext, refresh_token_iv, refresh_key_version, scopes_json, access_expires_at,
   refresh_expires_at, last_refreshed_at, revoked_at, created_at, updated_at)
SELECT id, workspace_id, connection_id, provider, access_token_ciphertext, access_token_iv, access_key_version,
       refresh_token_ciphertext, refresh_token_iv, refresh_key_version, scopes_json, access_expires_at,
       refresh_expires_at, last_refreshed_at, revoked_at, created_at, updated_at
FROM oauth_credentials;

DROP TABLE oauth_credentials;
ALTER TABLE oauth_credentials_next RENAME TO oauth_credentials;
CREATE INDEX idx_oauth_credentials_workspace_provider
  ON oauth_credentials(workspace_id, provider, revoked_at);

CREATE TABLE oauth_states_next (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES workspace_members(id),
  actor_subject TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('instagram', 'youtube', 'tiktok', 'meta')),
  connection_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO oauth_states_next
  (id, workspace_id, member_id, actor_subject, provider, connection_id, redirect_uri, expires_at, consumed_at, created_at)
SELECT id, workspace_id, member_id, actor_subject, provider, connection_id, redirect_uri, expires_at, consumed_at, created_at
FROM oauth_states;

DROP TABLE oauth_states;
ALTER TABLE oauth_states_next RENAME TO oauth_states;
CREATE INDEX idx_oauth_states_expiry
  ON oauth_states(provider, expires_at, consumed_at);
