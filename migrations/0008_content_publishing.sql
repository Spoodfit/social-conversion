PRAGMA foreign_keys = ON;

CREATE TABLE content_posts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  body TEXT NOT NULL,
  media_reference TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft', 'scheduled', 'cancelled', 'completed')),
  scheduled_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_post_targets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  post_id TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES social_connections(id),
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube', 'tiktok')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'publishing', 'published', 'blocked', 'failed', 'cancelled')),
  external_post_id TEXT,
  published_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (post_id, connection_id)
);

CREATE INDEX idx_content_posts_workspace_schedule
  ON content_posts(workspace_id, status, scheduled_at);

CREATE INDEX idx_content_post_targets_post
  ON content_post_targets(post_id, status);

CREATE INDEX idx_content_post_targets_connection
  ON content_post_targets(workspace_id, connection_id, status);
