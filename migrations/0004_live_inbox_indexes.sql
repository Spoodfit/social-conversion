CREATE INDEX idx_conversations_workspace_activity_cursor
  ON conversations(workspace_id, COALESCE(last_message_at, updated_at) DESC, id DESC);

CREATE INDEX idx_messages_conversation_cursor
  ON messages(conversation_id, sent_at DESC, id DESC);

CREATE INDEX idx_social_connections_workspace_platform
  ON social_connections(workspace_id, platform, status);
