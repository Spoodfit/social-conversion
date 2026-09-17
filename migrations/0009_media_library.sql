CREATE TABLE media_library (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('post', 'short', 'video', 'story')),
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_media_library_workspace_created
  ON media_library(workspace_id, created_at DESC);

CREATE INDEX idx_media_library_workspace_format
  ON media_library(workspace_id, format, created_at DESC);

CREATE TABLE media_uploads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  r2_key TEXT NOT NULL UNIQUE,
  upload_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('post', 'short', 'video', 'story')),
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'completed', 'aborted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_media_uploads_workspace_status
  ON media_uploads(workspace_id, status, created_at DESC);
