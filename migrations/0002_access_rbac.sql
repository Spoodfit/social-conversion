CREATE TABLE workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  access_subject TEXT,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'agent', 'viewer')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  activated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, email)
);

CREATE UNIQUE INDEX idx_workspace_members_subject
  ON workspace_members(workspace_id, access_subject)
  WHERE access_subject IS NOT NULL;

CREATE INDEX idx_workspace_members_identity
  ON workspace_members(access_subject, email, status);

CREATE UNIQUE INDEX idx_social_connections_external_account
  ON social_connections(platform, external_account_id)
  WHERE external_account_id IS NOT NULL;

ALTER TABLE webhook_events ADD COLUMN workspace_id TEXT;
ALTER TABLE webhook_events ADD COLUMN connection_id TEXT;
ALTER TABLE webhook_events ADD COLUMN external_event_id TEXT;

CREATE INDEX idx_webhook_events_workspace_received
  ON webhook_events(workspace_id, received_at DESC);

CREATE INDEX idx_audit_logs_workspace_created
  ON audit_logs(workspace_id, created_at DESC);
