PRAGMA foreign_keys = OFF;

CREATE TABLE content_post_destinations_v3 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  post_id TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  connection_id TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'linkedin', 'youtube', 'tiktok')),
  account_label TEXT NOT NULL,
  account_handle TEXT,
  format TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'ready', 'publishing', 'published', 'blocked', 'failed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO content_post_destinations_v3 (
  id, workspace_id, post_id, connection_id, platform, account_label, account_handle,
  format, fields_json, status, created_at, updated_at
)
SELECT
  id, workspace_id, post_id, connection_id, platform, account_label, account_handle,
  format, fields_json, status, created_at, updated_at
FROM content_post_destinations;

DROP TABLE content_post_destinations;
ALTER TABLE content_post_destinations_v3 RENAME TO content_post_destinations;

CREATE INDEX idx_content_post_destinations_post
  ON content_post_destinations(workspace_id, post_id, status);

CREATE INDEX idx_content_post_destinations_connection
  ON content_post_destinations(workspace_id, connection_id, status);

PRAGMA foreign_keys = ON;
