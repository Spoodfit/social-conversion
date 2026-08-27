PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE social_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube', 'tiktok')),
  external_account_id TEXT,
  display_name TEXT NOT NULL,
  handle TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  token_reference TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  external_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  handle TEXT,
  email TEXT,
  phone TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, platform, external_id)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connection_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  intent TEXT,
  sentiment TEXT,
  lead_stage TEXT NOT NULL DEFAULT 'Nouveau',
  estimated_value_cents INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  external_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL DEFAULT 'message',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  ai_assisted INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (external_id)
);

CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config_json TEXT NOT NULL,
  action_config_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES automation_rules(id),
  conversation_id TEXT REFERENCES conversations(id),
  status TEXT NOT NULL,
  result_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversations_workspace_activity ON conversations(workspace_id, last_message_at DESC);
CREATE INDEX idx_conversations_stage ON conversations(workspace_id, lead_stage);
CREATE INDEX idx_messages_conversation_time ON messages(conversation_id, sent_at);
CREATE INDEX idx_automation_runs_rule_time ON automation_runs(rule_id, started_at DESC);

INSERT INTO workspaces (id, name) VALUES ('default', 'Neptune Business Club');
