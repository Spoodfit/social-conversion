CREATE TABLE IF NOT EXISTS publication_remote_sync (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_id TEXT,
  external_url TEXT,
  upload_url TEXT,
  media_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'queued',
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, post_id, connection_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_publication_remote_sync_post
  ON publication_remote_sync(workspace_id, post_id, platform);

CREATE INDEX IF NOT EXISTS idx_publication_remote_sync_status
  ON publication_remote_sync(platform, sync_status, updated_at);
