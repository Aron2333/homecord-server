import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import {
  hasPermission,
  isServerOwner,
  getUserHighestRolePosition
} from '../services/permissionService.js';
import { logAuditEvent } from '../services/auditService.js';
import { Role } from '../types/index.js';

const router = Router();

// Get server roles
router.get('/:serverId/roles', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const roles = await query<Role[]>('SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC', [serverId]);
    for (const role of roles) {
      const perms = await query<{ permission_name: string }[]>(
        'SELECT permission_name FROM role_permissions WHERE role_id = ?',
        [role.id]
      );
      role.permissions = perms.map(p => p.permission_name);
    }
    res.json(roles);
  } catch (error) {
    console.error('Fetch roles error:', error);
    res.status(500).json({ error: 'Hiba a rangok lekérésekor' });
  }
});

// Create new role
router.post('/:serverId/roles', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { name, color, hoist, mentionable, permissions } = req.body;
    const actorId = req.user!.id;

    const canManageRoles = await hasPermission(serverId, actorId, 'MANAGE_ROLES');
    if (!canManageRoles) {
      res.status(403).json({ error: 'Nincs jogosultságod rangok létrehozásához!' });
      return;
    }

    const actorPos = await getUserHighestRolePosition(serverId, actorId);
    const newPos = Math.max(1, actorPos - 1);
    const roleId = uuidv4();

    await withTransaction(async (conn) => {
      // Shift other roles up or down to make space if needed
      await conn.query(
        'INSERT INTO roles (id, server_id, name, color, position, hoist, mentionable, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, NOW())',
        [roleId, serverId, (name || 'Új rang').trim(), color || '#99aab5', newPos, !!hoist, !!mentionable]
      );

      if (Array.isArray(permissions) && permissions.length > 0) {
        for (const p of permissions) {
          await conn.query(
            'INSERT INTO role_permissions (id, role_id, permission_name) VALUES (?, ?, ?)',
            [uuidv4(), roleId, p]
          );
        }
      }
    });

    await logAuditEvent({
      serverId,
      actorId,
      action: 'ROLE_CREATE',
      targetId: roleId,
      targetType: 'ROLE',
      metadata: { name, color }
    });

    const newRoles = await query<Role[]>('SELECT * FROM roles WHERE id = ?', [roleId]);
    res.status(201).json(newRoles[0]);
  } catch (error) {
    console.error('Create role error:', error);
    res.status(500).json({ error: 'Hiba a rang létrehozásakor' });
  }
});

// Update role (PUT & PATCH)
const handleUpdateRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, roleId } = req.params;
    const { name, color, hoist, mentionable, permissions } = req.body;
    const actorId = req.user!.id;

    const canManageRoles = await hasPermission(serverId, actorId, 'MANAGE_ROLES');
    if (!canManageRoles) {
      res.status(403).json({ error: 'Nincs jogosultságod rangok módosításához!' });
      return;
    }

    const roles = await query<Role[]>('SELECT * FROM roles WHERE id = ? AND server_id = ?', [roleId, serverId]);
    if (!roles || roles.length === 0) {
      res.status(404).json({ error: 'A rang nem található!' });
      return;
    }

    const targetRole = roles[0];
    const isOwner = await isServerOwner(serverId, actorId);
    const actorPos = await getUserHighestRolePosition(serverId, actorId);

    // Hierarchy check: user cannot edit role at or above their position (unless owner)
    if (!isOwner && targetRole.position >= actorPos) {
      res.status(403).json({ error: 'Nem módosíthatsz nálad egyenlő vagy magasabb rangot!' });
      return;
    }

    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE roles SET
           name = COALESCE(?, name),
           color = COALESCE(?, color),
           hoist = COALESCE(?, hoist),
           mentionable = COALESCE(?, mentionable)
         WHERE id = ?`,
        [
          name ? name.trim() : null,
          color || null,
          hoist !== undefined ? hoist : null,
          mentionable !== undefined ? mentionable : null,
          roleId
        ]
      );

      if (Array.isArray(permissions)) {
        await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
        for (const p of permissions) {
          await conn.query(
            'INSERT INTO role_permissions (id, role_id, permission_name) VALUES (?, ?, ?)',
            [uuidv4(), roleId, p]
          );
        }
      }
    });

    await logAuditEvent({
      serverId,
      actorId,
      action: 'ROLE_UPDATE',
      targetId: roleId,
      targetType: 'ROLE',
      metadata: { name, color, permissions }
    });

    const updated = await query<Role[]>('SELECT * FROM roles WHERE id = ?', [roleId]);
    res.json(updated[0]);
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Hiba a rang módosításakor' });
  }
};

router.put('/:serverId/roles/:roleId', authenticateToken, handleUpdateRole);
router.patch('/:serverId/roles/:roleId', authenticateToken, handleUpdateRole);

// Reorder roles
router.put('/:serverId/roles-order', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { roleOrders } = req.body; // array of { id: string, position: number }
    const actorId = req.user!.id;

    const canManageRoles = await hasPermission(serverId, actorId, 'MANAGE_ROLES');
    if (!canManageRoles) {
      res.status(403).json({ error: 'Nincs jogosultságod rangok átrendezéséhez!' });
      return;
    }

    const isOwner = await isServerOwner(serverId, actorId);
    const actorPos = await getUserHighestRolePosition(serverId, actorId);

    await withTransaction(async (conn) => {
      for (const item of roleOrders) {
        if (!isOwner && item.position >= actorPos) {
          continue; // skip roles user is not allowed to place at or above their rank
        }
        await conn.query('UPDATE roles SET position = ? WHERE id = ? AND server_id = ? AND is_default = FALSE', [
          item.position, item.id, serverId
        ]);
      }
    });

    await logAuditEvent({
      serverId,
      actorId,
      action: 'ROLES_REORDER',
      targetId: serverId,
      targetType: 'ROLES'
    });

    const allRoles = await query<Role[]>('SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC', [serverId]);
    res.json(allRoles);
  } catch (error) {
    console.error('Reorder roles error:', error);
    res.status(500).json({ error: 'Hiba a rangok átrendezésekor' });
  }
});

// Delete role
router.delete('/:serverId/roles/:roleId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, roleId } = req.params;
    const actorId = req.user!.id;

    const canManageRoles = await hasPermission(serverId, actorId, 'MANAGE_ROLES');
    if (!canManageRoles) {
      res.status(403).json({ error: 'Nincs jogosultságod rang törléséhez!' });
      return;
    }

    const roles = await query<Role[]>('SELECT * FROM roles WHERE id = ? AND server_id = ?', [roleId, serverId]);
    if (!roles || roles.length === 0) {
      res.status(404).json({ error: 'A rang nem található!' });
      return;
    }

    const targetRole = roles[0];
    if (targetRole.is_default) {
      res.status(400).json({ error: 'Az alapértelmezett (@everyone) rang nem törölhető!' });
      return;
    }

    const isOwner = await isServerOwner(serverId, actorId);
    const actorPos = await getUserHighestRolePosition(serverId, actorId);

    if (!isOwner && targetRole.position >= actorPos) {
      res.status(403).json({ error: 'Nem törölhetsz nálad egyenlő vagy magasabb rangot!' });
      return;
    }

    await query('DELETE FROM roles WHERE id = ?', [roleId]);

    await logAuditEvent({
      serverId,
      actorId,
      action: 'ROLE_DELETE',
      targetId: roleId,
      targetType: 'ROLE',
      metadata: { name: targetRole.name }
    });

    res.json({ message: 'Rang sikeresen törölve' });
  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({ error: 'Hiba a rang törlésekor' });
  }
});

// Assign role to member
router.post('/:serverId/members/:userId/roles/:roleId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, userId, roleId } = req.params;
    const actorId = req.user!.id;

    const canManageRoles = await hasPermission(serverId, actorId, 'MANAGE_ROLES');
    if (!canManageRoles) {
      res.status(403).json({ error: 'Nincs jogosultságod rangok kezelésére!' });
      return;
    }

    const roles = await query<Role[]>('SELECT * FROM roles WHERE id = ? AND server_id = ?', [roleId, serverId]);
    if (!roles || roles.length === 0) {
      res.status(404).json({ error: 'A rang nem található!' });
      return;
    }

    const isOwner = await isServerOwner(serverId, actorId);
    const actorPos = await getUserHighestRolePosition(serverId, actorId);

    if (!isOwner && roles[0].position >= actorPos) {
      res.status(403).json({ error: 'Nem rendelhetsz hozzá nálad egyenlő vagy magasabb rangot!' });
      return;
    }

    await query(
      'INSERT IGNORE INTO member_roles (id, server_id, user_id, role_id) VALUES (?, ?, ?, ?)',
      [uuidv4(), serverId, userId, roleId]
    );

    await logAuditEvent({
      serverId,
      actorId,
      action: 'MEMBER_ROLE_ADD',
      targetId: userId,
      targetType: 'USER',
      metadata: { roleId, roleName: roles[0].name }
    });

    res.json({ message: 'Rang sikeresen hozzárendelve' });
  } catch (error) {
    console.error('Assign role error:', error);
    res.status(500).json({ error: 'Hiba a rang hozzárendelésekor' });
  }
});

// Remove role from member
router.delete('/:serverId/members/:userId/roles/:roleId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, userId, roleId } = req.params;
    const actorId = req.user!.id;

    const canManageRoles = await hasPermission(serverId, actorId, 'MANAGE_ROLES');
    if (!canManageRoles) {
      res.status(403).json({ error: 'Nincs jogosultságod rangok kezelésére!' });
      return;
    }

    const roles = await query<Role[]>('SELECT * FROM roles WHERE id = ? AND server_id = ?', [roleId, serverId]);
    if (!roles || roles.length === 0) {
      res.status(404).json({ error: 'A rang nem található!' });
      return;
    }

    const isOwner = await isServerOwner(serverId, actorId);
    const actorPos = await getUserHighestRolePosition(serverId, actorId);

    if (!isOwner && roles[0].position >= actorPos) {
      res.status(403).json({ error: 'Nem vehetsz el nálad egyenlő vagy magasabb rangot!' });
      return;
    }

    await query(
      'DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?',
      [serverId, userId, roleId]
    );

    await logAuditEvent({
      serverId,
      actorId,
      action: 'MEMBER_ROLE_REMOVE',
      targetId: userId,
      targetType: 'USER',
      metadata: { roleId, roleName: roles[0].name }
    });

    res.json({ message: 'Rang sikeresen eltávolítva a felhasználótól' });
  } catch (error) {
    console.error('Remove role error:', error);
    res.status(500).json({ error: 'Hiba a rang eltávolításakor' });
  }
});

export default router;
