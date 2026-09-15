import { writeAuditLog, type WorkspacePrincipal } from './authorization';

export type AutomationPlatform = 'instagram' | 'youtube' | 'tiktok';
export type AutomationTriggerType = 'incoming_message' | 'comment' | 'manual';
export type AutomationActionType = 'move_stage' | 'set_priority' | 'create_ai_draft' | 'send_message';

const platforms = new Set<AutomationPlatform>(['instagram', 'youtube', 'tiktok']);
const triggerTypes = new Set<AutomationTriggerType>(['incoming_message', 'comment', 'manual']);
const actionTypes = new Set<AutomationActionType>(['move_stage', 'set_priority', 'create_ai_draft', 'send_message']);
const identifierPattern = /^[A-Za-z0-9:_-]{1,200}$/;

interface ConnectionRow {
  id: string;
  platform: AutomationPlatform;
  status: string;
  capabilities_json: string;
}

interface AutomationRow {
  id: string;
  workspace_id: string;
  connection_id: string | null;
  name: string;
  platform: AutomationPlatform;
  trigger_type: AutomationTriggerType;
  trigger_config_json: string;
  action_config_json: string;
  active: number;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export class AutomationError extends Error {
  readonly code:
    | 'INVALID_AUTOMATION'
    | 'CONNECTION_NOT_FOUND'
    | 'AUTOMATION_NOT_FOUND'
    | 'AUTOMATION_CONFLICT'
    | 'AUTOMATION_EXECUTION_NOT_READY';

  constructor(code: AutomationError['code'], message: string) {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
  }
}

function plainJsonObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AutomationError('INVALID_AUTOMATION', `${field} must be a JSON object.`);
  }
  const record = value as Record<string, unknown>;
  const encoded = JSON.stringify(record);
  if (encoded.length > 8_000) {
    throw new AutomationError('INVALID_AUTOMATION', `${field} exceeds the 8,000 character limit.`);
  }
  return record;
}

function normalizedName(value: unknown): string {
  if (typeof value !== 'string') throw new AutomationError('INVALID_AUTOMATION', 'name is required.');
  const name = value.trim();
  if (!name || name.length > 120) throw new AutomationError('INVALID_AUTOMATION', 'name must contain 1 to 120 characters.');
  return name;
}

function parsePlatform(value: unknown): AutomationPlatform {
  if (typeof value !== 'string' || !platforms.has(value as AutomationPlatform)) {
    throw new AutomationError('INVALID_AUTOMATION', 'platform is invalid.');
  }
  return value as AutomationPlatform;
}

function parseTriggerType(value: unknown): AutomationTriggerType {
  if (typeof value !== 'string' || !triggerTypes.has(value as AutomationTriggerType)) {
    throw new AutomationError('INVALID_AUTOMATION', 'triggerType is invalid.');
  }
  return value as AutomationTriggerType;
}

function parseActionType(config: Record<string, unknown>): AutomationActionType {
  const value = config.type;
  if (typeof value !== 'string' || !actionTypes.has(value as AutomationActionType)) {
    throw new AutomationError('INVALID_AUTOMATION', 'actionConfig.type is invalid.');
  }
  return value as AutomationActionType;
}

function validateActionConfig(actionType: AutomationActionType, config: Record<string, unknown>): void {
  if (actionType === 'move_stage') {
    const stage = config.stage;
    if (typeof stage !== 'string' || !['Nouveau', 'Qualifié', 'Rendez-vous', 'Proposition', 'Gagné', 'Perdu'].includes(stage)) {
      throw new AutomationError('INVALID_AUTOMATION', 'move_stage requires a valid stage.');
    }
  }
  if (actionType === 'set_priority') {
    const priority = config.priority;
    if (typeof priority !== 'string' || !/^[A-Za-zÀ-ÿ0-9 _-]{1,32}$/.test(priority.trim())) {
      throw new AutomationError('INVALID_AUTOMATION', 'set_priority requires a valid priority.');
    }
  }
  if (actionType === 'send_message') {
    const template = config.template;
    if (typeof template !== 'string' || !template.trim() || template.length > 2_000) {
      throw new AutomationError('INVALID_AUTOMATION', 'send_message requires a template up to 2,000 characters.');
    }
  }
}

function parseCapabilities(value: string): Record<string, boolean> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const capabilities: Record<string, boolean> = {};
    for (const [key, enabled] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof enabled === 'boolean') capabilities[key] = enabled;
    }
    return capabilities;
  } catch {
    return {};
  }
}

function requiredCapability(triggerType: AutomationTriggerType, actionType: AutomationActionType): string[] {
  const requirements = new Set<string>();
  if (triggerType === 'incoming_message') requirements.add('direct_messages');
  if (triggerType === 'comment') requirements.add('comments');
  if (actionType === 'send_message') requirements.add('direct_messages');
  if (actionType === 'create_ai_draft') requirements.add('ai_drafts');
  return [...requirements];
}

async function requireConnection(
  db: D1Database,
  workspaceId: string,
  connectionId: string,
  platform: AutomationPlatform,
): Promise<ConnectionRow> {
  if (!identifierPattern.test(connectionId)) {
    throw new AutomationError('INVALID_AUTOMATION', 'connectionId is invalid.');
  }
  const row = await db.prepare(
    `SELECT id, platform, status, capabilities_json
     FROM social_connections
     WHERE id = ? AND workspace_id = ?`,
  ).bind(connectionId, workspaceId).first<ConnectionRow>();
  if (!row || row.platform !== platform) {
    throw new AutomationError('CONNECTION_NOT_FOUND', 'Connection not found for this workspace/platform.');
  }
  return row;
}

function decodeConfig(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toAutomation(row: AutomationRow, connection?: ConnectionRow) {
  const triggerConfig = decodeConfig(row.trigger_config_json);
  const actionConfig = decodeConfig(row.action_config_json);
  const actionType = typeof actionConfig.type === 'string' && actionTypes.has(actionConfig.type as AutomationActionType)
    ? actionConfig.type as AutomationActionType
    : undefined;
  const capabilityKeys = actionType ? requiredCapability(row.trigger_type, actionType) : [];
  const capabilities = connection ? parseCapabilities(connection.capabilities_json) : {};
  const missingCapabilities = capabilityKeys.filter((capability) => capabilities[capability] !== true);

  return {
    id: row.id,
    connectionId: row.connection_id ?? undefined,
    name: row.name,
    platform: row.platform,
    triggerType: row.trigger_type,
    triggerConfig,
    actionConfig,
    active: row.active === 1,
    version: row.version,
    executionReady: false,
    missingCapabilities,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAutomationDrafts(
  db: D1Database,
  workspaceId: string,
  filters: { connectionId?: string; platform?: string } = {},
) {
  const conditions = ['ar.workspace_id = ?', 'ar.archived_at IS NULL'];
  const bindings: unknown[] = [workspaceId];
  if (filters.connectionId) {
    if (!identifierPattern.test(filters.connectionId)) throw new AutomationError('INVALID_AUTOMATION', 'connectionId is invalid.');
    conditions.push('ar.connection_id = ?');
    bindings.push(filters.connectionId);
  }
  if (filters.platform) {
    const platform = parsePlatform(filters.platform);
    conditions.push('ar.platform = ?');
    bindings.push(platform);
  }

  const result = await db.prepare(
    `SELECT ar.id, ar.workspace_id, ar.connection_id, ar.name, ar.platform,
            ar.trigger_type, ar.trigger_config_json, ar.action_config_json,
            ar.active, ar.version, ar.created_by, ar.updated_by,
            ar.created_at, ar.updated_at, ar.archived_at
     FROM automation_rules ar
     WHERE ${conditions.join(' AND ')}
     ORDER BY ar.updated_at DESC, ar.id DESC`,
  ).bind(...bindings).all<AutomationRow>();

  const connectionIds = [...new Set(result.results.map((rule) => rule.connection_id).filter((id): id is string => Boolean(id)))];
  const connections = new Map<string, ConnectionRow>();
  if (connectionIds.length) {
    const placeholders = connectionIds.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT id, platform, status, capabilities_json
       FROM social_connections
       WHERE workspace_id = ? AND id IN (${placeholders})`,
    ).bind(workspaceId, ...connectionIds).all<ConnectionRow>();
    for (const connection of rows.results) connections.set(connection.id, connection);
  }

  return {
    automations: result.results.map((row) => toAutomation(row, row.connection_id ? connections.get(row.connection_id) : undefined)),
    executionReady: false,
  };
}

export async function createAutomationDraft(
  db: D1Database,
  principal: WorkspacePrincipal,
  input: {
    name?: unknown;
    connectionId?: unknown;
    platform?: unknown;
    triggerType?: unknown;
    triggerConfig?: unknown;
    actionConfig?: unknown;
    active?: unknown;
  },
) {
  if (input.active === true) {
    throw new AutomationError('AUTOMATION_EXECUTION_NOT_READY', 'Automation execution is not enabled yet. Save this rule as a draft.');
  }
  const name = normalizedName(input.name);
  const platform = parsePlatform(input.platform);
  const triggerType = parseTriggerType(input.triggerType);
  if (typeof input.connectionId !== 'string') throw new AutomationError('INVALID_AUTOMATION', 'connectionId is required.');
  const connection = await requireConnection(db, principal.workspaceId, input.connectionId, platform);
  const triggerConfig = plainJsonObject(input.triggerConfig ?? {}, 'triggerConfig');
  const actionConfig = plainJsonObject(input.actionConfig, 'actionConfig');
  const actionType = parseActionType(actionConfig);
  validateActionConfig(actionType, actionConfig);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO automation_rules
      (id, workspace_id, connection_id, name, platform, trigger_type,
       trigger_config_json, action_config_json, active, version,
       created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)`,
  ).bind(
    id,
    principal.workspaceId,
    connection.id,
    name,
    platform,
    triggerType,
    JSON.stringify(triggerConfig),
    JSON.stringify(actionConfig),
    principal.subject,
    principal.subject,
    now,
    now,
  ).run();

  await writeAuditLog(db, principal, 'automation.draft_created', 'automation_rule', id, {
    platform,
    triggerType,
    actionType,
    connectionId: connection.id,
  });

  const row = await db.prepare(
    `SELECT id, workspace_id, connection_id, name, platform, trigger_type,
            trigger_config_json, action_config_json, active, version,
            created_by, updated_by, created_at, updated_at, archived_at
     FROM automation_rules WHERE id = ? AND workspace_id = ?`,
  ).bind(id, principal.workspaceId).first<AutomationRow>();
  if (!row) throw new Error('Automation draft could not be read back.');
  return toAutomation(row, connection);
}

export async function updateAutomationDraft(
  db: D1Database,
  principal: WorkspacePrincipal,
  id: string,
  input: {
    expectedVersion?: unknown;
    name?: unknown;
    triggerType?: unknown;
    triggerConfig?: unknown;
    actionConfig?: unknown;
    active?: unknown;
  },
) {
  if (!identifierPattern.test(id)) throw new AutomationError('AUTOMATION_NOT_FOUND', 'Automation not found.');
  if (input.active === true) {
    throw new AutomationError('AUTOMATION_EXECUTION_NOT_READY', 'Automation execution is not enabled yet. Save this rule as a draft.');
  }
  if (!Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) {
    throw new AutomationError('INVALID_AUTOMATION', 'expectedVersion is required for safe concurrent updates.');
  }

  const current = await db.prepare(
    `SELECT id, workspace_id, connection_id, name, platform, trigger_type,
            trigger_config_json, action_config_json, active, version,
            created_by, updated_by, created_at, updated_at, archived_at
     FROM automation_rules
     WHERE id = ? AND workspace_id = ? AND archived_at IS NULL`,
  ).bind(id, principal.workspaceId).first<AutomationRow>();
  if (!current) throw new AutomationError('AUTOMATION_NOT_FOUND', 'Automation not found.');

  const triggerType = input.triggerType === undefined ? current.trigger_type : parseTriggerType(input.triggerType);
  const triggerConfig = input.triggerConfig === undefined ? decodeConfig(current.trigger_config_json) : plainJsonObject(input.triggerConfig, 'triggerConfig');
  const actionConfig = input.actionConfig === undefined ? decodeConfig(current.action_config_json) : plainJsonObject(input.actionConfig, 'actionConfig');
  const actionType = parseActionType(actionConfig);
  validateActionConfig(actionType, actionConfig);
  const name = input.name === undefined ? current.name : normalizedName(input.name);
  if (!current.connection_id) throw new AutomationError('CONNECTION_NOT_FOUND', 'Automation has no scoped connection.');
  const connection = await requireConnection(db, principal.workspaceId, current.connection_id, current.platform);
  const now = new Date().toISOString();

  const updated = await db.prepare(
    `UPDATE automation_rules
     SET name = ?, trigger_type = ?, trigger_config_json = ?, action_config_json = ?,
         active = 0, version = version + 1, updated_by = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND archived_at IS NULL AND version = ?
     RETURNING id, workspace_id, connection_id, name, platform, trigger_type,
               trigger_config_json, action_config_json, active, version,
               created_by, updated_by, created_at, updated_at, archived_at`,
  ).bind(
    name,
    triggerType,
    JSON.stringify(triggerConfig),
    JSON.stringify(actionConfig),
    principal.subject,
    now,
    id,
    principal.workspaceId,
    Number(input.expectedVersion),
  ).first<AutomationRow>();

  if (!updated) {
    throw new AutomationError('AUTOMATION_CONFLICT', 'Automation changed since it was loaded. Refresh before retrying.');
  }

  await writeAuditLog(db, principal, 'automation.draft_updated', 'automation_rule', id, {
    platform: current.platform,
    triggerType,
    actionType,
    version: updated.version,
  });
  return toAutomation(updated, connection);
}

export async function archiveAutomationDraft(
  db: D1Database,
  principal: WorkspacePrincipal,
  id: string,
  expectedVersion: unknown,
): Promise<void> {
  if (!identifierPattern.test(id)) throw new AutomationError('AUTOMATION_NOT_FOUND', 'Automation not found.');
  if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
    throw new AutomationError('INVALID_AUTOMATION', 'expectedVersion is required for safe concurrent updates.');
  }
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE automation_rules
     SET active = 0, archived_at = ?, version = version + 1, updated_by = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND archived_at IS NULL AND version = ?`,
  ).bind(now, principal.subject, now, id, principal.workspaceId, Number(expectedVersion)).run();
  if ((result.meta.changes ?? 0) !== 1) {
    const exists = await db.prepare(
      'SELECT version FROM automation_rules WHERE id = ? AND workspace_id = ? AND archived_at IS NULL',
    ).bind(id, principal.workspaceId).first<{ version: number }>();
    if (!exists) throw new AutomationError('AUTOMATION_NOT_FOUND', 'Automation not found.');
    throw new AutomationError('AUTOMATION_CONFLICT', 'Automation changed since it was loaded. Refresh before retrying.');
  }
  await writeAuditLog(db, principal, 'automation.draft_archived', 'automation_rule', id, {
    previousVersion: Number(expectedVersion),
  });
}
