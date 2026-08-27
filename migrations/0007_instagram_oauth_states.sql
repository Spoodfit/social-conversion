PRAGMA foreign_keys = ON;

CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES workspace_members(id),
  actor_subject TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('instagram')),
  connection_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_oauth_states_expiry
  ON oauth_states(provider, expires_at, consumed_at);
