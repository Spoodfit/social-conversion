PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS linkedin_community_oauth_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES workspace_members(id),
  actor_subject TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_linkedin_community_oauth_states_expiry
  ON linkedin_community_oauth_states(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS linkedin_organization_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  external_account_id TEXT NOT NULL,
  organization_urn TEXT NOT NULL,
  display_name TEXT NOT NULL,
  handle TEXT,
  admin_role TEXT,
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
  UNIQUE(workspace_id, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_org_connections_workspace_status
  ON linkedin_organization_connections(workspace_id, status, display_name);

CREATE TABLE IF NOT EXISTS linkedin_remote_posts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connection_id TEXT NOT NULL REFERENCES linkedin_organization_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_type TEXT,
  external_url TEXT,
  event_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_remote_posts_timeline
  ON linkedin_remote_posts(workspace_id, event_at, connection_id);

CREATE TABLE IF NOT EXISTS linkedin_runtime_sync_state (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connection_id TEXT NOT NULL REFERENCES linkedin_organization_connections(id) ON DELETE CASCADE,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  PRIMARY KEY(workspace_id, connection_id)
);
