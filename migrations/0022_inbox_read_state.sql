PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversation_reads (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, member_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_reads_member
  ON conversation_reads(workspace_id, member_id, last_read_at DESC);
