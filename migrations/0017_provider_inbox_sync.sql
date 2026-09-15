CREATE TABLE IF NOT EXISTS provider_inbox_sync_state (
  workspace_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  PRIMARY KEY (workspace_id, connection_id, platform),
  FOREIGN KEY (connection_id) REFERENCES social_connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_inbox_sync_workspace_attempt
  ON provider_inbox_sync_state(workspace_id, last_attempt_at);
