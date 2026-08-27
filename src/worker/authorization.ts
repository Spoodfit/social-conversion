import type { AccessIdentity } from './auth';

export type WorkspaceRole = 'admin' | 'manager' | 'agent' | 'viewer';

export interface WorkspacePrincipal extends AccessIdentity {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  memberId: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  status: 'invited' | 'active';
}

export type MembershipResolution =
  | { status: 'granted'; principal: WorkspacePrincipal }
  | { status: 'forbidden' }
  | { status: 'workspace_required' };

interface MembershipRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  access_subject: string | null;
  email: string;
  role: WorkspaceRole;
  status: 'invited' | 'active';
}

const workspaceIdPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

export function validWorkspaceId(value: string | undefined): value is string {
  return typeof value === 'string' && workspaceIdPattern.test(value);
}

export function roleCanMutate(role: WorkspaceRole): boolean {
  return role === 'admin' || role === 'manager' || role === 'agent';
}

export async function listWorkspaceMemberships(
  db: D1Database,
  identity: AccessIdentity,
): Promise<WorkspaceSummary[]> {
  const result = await db
    .prepare(
      `SELECT
         wm.workspace_id,
         w.name AS workspace_name,
         wm.role,
         wm.status
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE (
         (wm.status = 'active' AND wm.access_subject = ?)
         OR
         (wm.status = 'invited' AND wm.access_subject IS NULL AND wm.email = ?)
       )
       ORDER BY w.name, wm.workspace_id`,
    )
    .bind(identity.subject, identity.email ?? '')
    .all<Pick<MembershipRow, 'workspace_id' | 'workspace_name' | 'role' | 'status'>>();

  return result.results.map((membership) => ({
    id: membership.workspace_id,
    name: membership.workspace_name,
    role: membership.role,
    status: membership.status,
  }));
}

export async function resolveWorkspaceMembership(
  db: D1Database,
  identity: AccessIdentity,
  requestedWorkspaceId?: string,
): Promise<MembershipResolution> {
  if (requestedWorkspaceId !== undefined && !validWorkspaceId(requestedWorkspaceId)) {
    return { status: 'forbidden' };
  }

  const result = await db
    .prepare(
      `SELECT
         wm.id,
         wm.workspace_id,
         w.name AS workspace_name,
         wm.access_subject,
         wm.email,
         wm.role,
         wm.status
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE (
         (wm.status = 'active' AND wm.access_subject = ?)
         OR
         (wm.status = 'invited' AND wm.access_subject IS NULL AND wm.email = ?)
       )
       AND (? IS NULL OR wm.workspace_id = ?)
       ORDER BY wm.workspace_id
       LIMIT 2`,
    )
    .bind(
      identity.subject,
      identity.email ?? '',
      requestedWorkspaceId ?? null,
      requestedWorkspaceId ?? null,
    )
    .all<MembershipRow>();

  if (result.results.length === 0) return { status: 'forbidden' };
  if (!requestedWorkspaceId && result.results.length > 1) return { status: 'workspace_required' };

  const membership = result.results[0];
  if (!membership) return { status: 'forbidden' };

  if (membership.status === 'invited') {
    const activatedAt = new Date().toISOString();
    const activation = await db
      .prepare(
        `UPDATE workspace_members
         SET access_subject = ?, status = 'active', activated_at = ?, updated_at = ?
         WHERE id = ? AND status = 'invited' AND access_subject IS NULL`,
      )
      .bind(identity.subject, activatedAt, activatedAt, membership.id)
      .run();

    if ((activation.meta.changes ?? 0) !== 1) {
      const concurrentlyActivated = await db
        .prepare(
          `SELECT access_subject, status
           FROM workspace_members
           WHERE id = ? AND access_subject = ? AND status = 'active'`,
        )
        .bind(membership.id, identity.subject)
        .first<{ access_subject: string; status: string }>();
      if (!concurrentlyActivated) return { status: 'forbidden' };
    }
  }

  return {
    status: 'granted',
    principal: {
      ...identity,
      memberId: membership.id,
      workspaceId: membership.workspace_id,
      workspaceName: membership.workspace_name,
      role: membership.role,
    },
  };
}

export async function writeAuditLog(
  db: D1Database,
  principal: WorkspacePrincipal,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs
        (id, workspace_id, actor_id, action, resource_type, resource_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      principal.workspaceId,
      principal.subject,
      action,
      resourceType,
      resourceId ?? null,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}
