PRAGMA foreign_keys = ON;

CREATE TABLE oauth_states_next (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES workspace_members(id),
  actor_subject TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('instagram', 'youtube', 'tiktok')),
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
