PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS threads_remote_posts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connection_id TEXT NOT NULL REFERENCES threads_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_type TEXT,
  preview_url TEXT,
  external_url TEXT,
  event_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_threads_remote_posts_timeline
  ON threads_remote_posts(workspace_id, event_at, connection_id);

CREATE INDEX IF NOT EXISTS idx_threads_remote_posts_connection
  ON threads_remote_posts(workspace_id, connection_id, event_at);

CREATE TABLE IF NOT EXISTS threads_runtime_sync_state (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connection_id TEXT NOT NULL REFERENCES threads_connections(id) ON DELETE CASCADE,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  PRIMARY KEY(workspace_id, connection_id)
);
