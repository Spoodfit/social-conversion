PRAGMA foreign_keys = ON;

CREATE TABLE oauth_credentials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connection_id TEXT NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('instagram', 'youtube', 'tiktok')),
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_iv TEXT,
  key_version TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  access_expires_at TEXT,
  refresh_expires_at TEXT,
  last_refreshed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (connection_id)
);

CREATE INDEX idx_oauth_credentials_workspace_provider
  ON oauth_credentials(workspace_id, provider, revoked_at);

CREATE TABLE outbound_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  connection_id TEXT NOT NULL REFERENCES social_connections(id),
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube', 'tiktok')),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_id TEXT,
  last_error_code TEXT,
  last_error_at TEXT,
  next_attempt_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX idx_outbound_messages_dispatch
  ON outbound_messages(status, next_attempt_at, created_at);

CREATE INDEX idx_outbound_messages_workspace_conversation
  ON outbound_messages(workspace_id, conversation_id, created_at DESC);

CREATE TABLE privacy_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  contact_id TEXT REFERENCES contacts(id),
  request_type TEXT NOT NULL CHECK (request_type IN ('export', 'delete')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed', 'rejected')),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  result_reference TEXT,
  notes TEXT
);

CREATE INDEX idx_privacy_requests_workspace_status
  ON privacy_requests(workspace_id, status, requested_at DESC);
