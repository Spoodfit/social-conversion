CREATE TABLE IF NOT EXISTS meta_asset_selections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES workspace_members(id),
  actor_subject TEXT NOT NULL,
  requested_platform TEXT NOT NULL CHECK (requested_platform IN ('facebook', 'instagram')),
  user_token_ciphertext TEXT NOT NULL,
  user_token_iv TEXT NOT NULL,
  user_key_version TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_asset_selections_owner
  ON meta_asset_selections(workspace_id, actor_subject, expires_at, completed_at);

CREATE INDEX IF NOT EXISTS idx_social_connections_external_identity
  ON social_connections(workspace_id, platform, external_account_id);

DELETE FROM social_connections
WHERE status = 'pending'
  AND external_account_id IS NULL
  AND platform IN ('youtube', 'tiktok')
  AND NOT EXISTS (
    SELECT 1 FROM oauth_credentials oc
    WHERE oc.connection_id = social_connections.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM content_post_destinations d
    WHERE d.connection_id = social_connections.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM content_post_targets t
    WHERE t.connection_id = social_connections.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.connection_id = social_connections.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM publication_remote_sync rs
    WHERE rs.connection_id = social_connections.id
  );
