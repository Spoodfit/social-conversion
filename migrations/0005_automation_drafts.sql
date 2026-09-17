ALTER TABLE automation_rules ADD COLUMN connection_id TEXT REFERENCES social_connections(id);
ALTER TABLE automation_rules ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE automation_rules ADD COLUMN created_by TEXT;
ALTER TABLE automation_rules ADD COLUMN updated_by TEXT;
ALTER TABLE automation_rules ADD COLUMN archived_at TEXT;

CREATE INDEX idx_automation_rules_workspace_connection
  ON automation_rules(workspace_id, connection_id, archived_at, updated_at DESC);

CREATE INDEX idx_automation_rules_workspace_platform
  ON automation_rules(workspace_id, platform, archived_at, updated_at DESC);
