CREATE TABLE IF NOT EXISTS inbox_message_reactions (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  reaction_type TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, message_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inbox_message_reactions_conversation
  ON inbox_message_reactions(workspace_id, conversation_id);
