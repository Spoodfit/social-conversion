PRAGMA foreign_keys = ON;

CREATE TABLE content_post_destinations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  post_id TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES social_connections(id),
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube', 'tiktok')),
  account_label TEXT NOT NULL,
  account_handle TEXT,
  format TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'ready', 'publishing', 'published', 'blocked', 'failed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_content_post_destinations_post
  ON content_post_destinations(workspace_id, post_id, status);

CREATE INDEX idx_content_post_destinations_connection
  ON content_post_destinations(workspace_id, connection_id, status);

INSERT INTO content_post_destinations (
  id,
  workspace_id,
  post_id,
  connection_id,
  platform,
  account_label,
  account_handle,
  format,
  fields_json,
  status,
  created_at,
  updated_at
)
SELECT
  'dest-' || t.id,
  t.workspace_id,
  t.post_id,
  t.connection_id,
  t.platform,
  COALESCE(sc.display_name, t.platform),
  sc.handle,
  CASE t.platform
    WHEN 'instagram' THEN 'post'
    WHEN 'youtube' THEN 'video'
    ELSE 'video'
  END,
  '{}',
  CASE WHEN sc.status = 'connected' THEN 'ready' ELSE 'planned' END,
  t.created_at,
  t.updated_at
FROM content_post_targets t
LEFT JOIN social_connections sc ON sc.id = t.connection_id
WHERE NOT EXISTS (
  SELECT 1 FROM content_post_destinations existing WHERE existing.post_id = t.post_id
);
