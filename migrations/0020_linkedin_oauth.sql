PRAGMA foreign_keys = ON;

CREATE TABLE linkedin_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  external_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  handle TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'expired', 'revoked', 'error')),
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  access_key_version TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_iv TEXT,
  refresh_key_version TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  access_expires_at TEXT,
  refresh_expires_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, external_account_id)
);

CREATE INDEX idx_linkedin_connections_workspace_status
  ON linkedin_connections(workspace_id, status, display_name);

CREATE TABLE linkedin_oauth_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES workspace_members(id),
  actor_subject TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_linkedin_oauth_states_expiry
  ON linkedin_oauth_states(expires_at, consumed_at);
