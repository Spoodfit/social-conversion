CREATE TABLE ai_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_response_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  version INTEGER NOT NULL DEFAULT 1,
  source_conversation_updated_at TEXT NOT NULL,
  prompt_message_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ai_drafts_workspace_conversation
  ON ai_drafts(workspace_id, conversation_id, created_at DESC);

CREATE INDEX idx_ai_drafts_workspace_status
  ON ai_drafts(workspace_id, status, updated_at DESC);
