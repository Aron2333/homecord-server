import { query } from '../database/db.js';
import { Role } from '../types/index.js';

export async function isServerOwner(serverId: string, userId: string): Promise<boolean> {
  const rows = await query<{ owner_id: string }[]>(
    'SELECT owner_id FROM servers WHERE id = ?',
    [serverId]
  );
  if (!rows || rows.length === 0) return false;
  return rows[0].owner_id === userId;
}

export async function getUserHighestRolePosition(serverId: string, userId: string): Promise<number> {
  const isOwner = await isServerOwner(serverId, userId);
  if (isOwner) return 999999; // Owner is highest

  const rows = await query<{ max_pos: number | null }[]>(
    `SELECT MAX(r.position) as max_pos
     FROM roles r
     JOIN member_roles mr ON mr.role_id = r.id
     WHERE r.server_id = ? AND mr.user_id = ?`,
    [serverId, userId]
  );

  return rows[0]?.max_pos ?? 0;
}

export async function getUserPermissions(serverId: string, userId: string): Promise<Set<string>> {
  const isOwner = await isServerOwner(serverId, userId);
  if (isOwner) {
    return new Set(['ADMINISTRATOR', 'ALL']);
  }

  // Get all permissions assigned to any role the user has in this server, or the @everyone (default) role
  const rows = await query<{ permission_name: string }[]>(
    `SELECT DISTINCT rp.permission_name
     FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
     WHERE r.server_id = ? AND (
       r.is_default = TRUE OR
       r.id IN (SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?)
     )`,
    [serverId, serverId, userId]
  );

  const permissions = new Set<string>();
  for (const r of rows) {
    permissions.add(r.permission_name);
  }

  return permissions;
}

export async function hasPermission(
  serverId: string,
  userId: string,
  requiredPermission: string
): Promise<boolean> {
  const isOwner = await isServerOwner(serverId, userId);
  if (isOwner) return true;

  const perms = await getUserPermissions(serverId, userId);
  if (perms.has('ADMINISTRATOR')) return true;

  return perms.has(requiredPermission);
}

export async function canManageTarget(
  serverId: string,
  actorUserId: string,
  targetUserId: string
): Promise<boolean> {
  if (actorUserId === targetUserId) return false;

  const isActorOwner = await isServerOwner(serverId, actorUserId);
  if (isActorOwner) return true;

  const isTargetOwner = await isServerOwner(serverId, targetUserId);
  if (isTargetOwner) return false; // Non-owner can never manage owner

  const actorHighestPos = await getUserHighestRolePosition(serverId, actorUserId);
  const targetHighestPos = await getUserHighestRolePosition(serverId, targetUserId);

  return actorHighestPos > targetHighestPos;
}

export async function canManageRole(
  serverId: string,
  actorUserId: string,
  targetRole: Role
): Promise<boolean> {
  const isActorOwner = await isServerOwner(serverId, actorUserId);
  if (isActorOwner) return true;

  const actorHighestPos = await getUserHighestRolePosition(serverId, actorUserId);
  return actorHighestPos > targetRole.position;
}
