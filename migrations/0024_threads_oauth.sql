CREATE TABLE IF NOT EXISTS threads_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  external_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  handle TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  access_key_version TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  access_expires_at TEXT,
  last_refreshed_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_threads_connections_workspace_status
  ON threads_connections(workspace_id, status, display_name);

CREATE INDEX IF NOT EXISTS idx_threads_connections_refresh
  ON threads_connections(status, access_expires_at, last_refreshed_at);

CREATE TABLE IF NOT EXISTS threads_oauth_states (
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

CREATE INDEX IF NOT EXISTS idx_threads_oauth_states_expiry
  ON threads_oauth_states(expires_at, consumed_at);
