PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS planner_remote_posts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connection_id TEXT NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube', 'tiktok')),
  external_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_type TEXT,
  visibility TEXT,
  external_url TEXT,
  provider_status TEXT NOT NULL CHECK (provider_status IN ('published', 'scheduled')),
  event_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, connection_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_remote_posts_timeline
  ON planner_remote_posts(workspace_id, event_at, platform);

CREATE INDEX IF NOT EXISTS idx_planner_remote_posts_connection
  ON planner_remote_posts(workspace_id, connection_id, event_at);

CREATE TABLE IF NOT EXISTS planner_remote_sync_state (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connection_id TEXT NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube', 'tiktok')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  PRIMARY KEY(workspace_id, connection_id, platform)
);
