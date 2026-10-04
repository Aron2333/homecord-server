import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import {
  hasPermission,
  isServerOwner,
  canManageTarget,
  getUserHighestRolePosition
} from '../services/permissionService.js';
import { logAuditEvent } from '../services/auditService.js';
import { Server, Role, Channel, ChannelCategory, Tag } from '../types/index.js';

const router = Router();

// List servers for current user
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const servers = await query<Server[]>(
      `SELECT s.* FROM servers s
       JOIN server_members sm ON sm.server_id = s.id
       WHERE sm.user_id = ?
       ORDER BY sm.joined_at ASC`,
      [req.user!.id]
    );

    res.json(servers);
  } catch (error) {
    console.error('List servers error:', error);
    res.status(500).json({ error: 'Hiba a szerverek lekérésekor' });
  }
});

// Create new server
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, icon_url } = req.body;
    const userId = req.user!.id;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'A szerver neve nem lehet üres!' });
      return;
    }

    const serverId = uuidv4();
    const everyoneRoleId = uuidv4();
    const ownerRoleId = uuidv4();
    const adminRoleId = uuidv4();
    const modRoleId = uuidv4();
    const devRoleId = uuidv4();
    const memberRoleId = uuidv4();

    const textCatId = uuidv4();
    const voiceCatId = uuidv4();
    const generalChanId = uuidv4();
    const announceChanId = uuidv4();
    const voiceChanId = uuidv4();

    await withTransaction(async (conn) => {
      // 1. Insert server
      await conn.query(
        'INSERT INTO servers (id, name, icon_url, owner_id, created_at) VALUES (?, ?, ?, ?, NOW())',
        [serverId, name.trim(), icon_url || null, userId]
      );

      // 2. Insert member (owner)
      await conn.query(
        'INSERT INTO server_members (id, server_id, user_id, joined_at) VALUES (?, ?, ?, NOW())',
        [uuidv4(), serverId, userId]
      );

      // 3. Create default roles with hierarchy
      // @everyone (pos 0)
      await conn.query(
        'INSERT INTO roles (id, server_id, name, color, position, hoist, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [everyoneRoleId, serverId, '@everyone', '#99aab5', 0, false, true]
      );
      // Member (pos 1)
      await conn.query(
        'INSERT INTO roles (id, server_id, name, color, position, hoist, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [memberRoleId, serverId, 'Tag', '#2ecc71', 1, false, false]
      );
      // Dev (pos 2)
      await conn.query(
        'INSERT INTO roles (id, server_id, name, color, position, hoist, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [devRoleId, serverId, 'Fejlesztő', '#9b59b6', 2, true, false]
      );
      // Mod (pos 3)
      await conn.query(
        'INSERT INTO roles (id, server_id, name, color, position, hoist, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [modRoleId, serverId, 'Moderátor', '#3498db', 3, true, false]
      );
      // Admin (pos 4)
      await conn.query(
        'INSERT INTO roles (id, server_id, name, color, position, hoist, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [adminRoleId, serverId, 'Adminisztrátor', '#e67e22', 4, true, false]
      );
      // Owner (pos 5)
      await conn.query(
        'INSERT INTO roles (id, server_id, name, color, position, hoist, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [ownerRoleId, serverId, 'Tulajdonos', '#e74c3c', 5, true, false]
      );

      // 4. Default role permissions
      // Everyone permissions
      const everyonePerms = ['SEND_MESSAGES', 'READ_MESSAGES', 'ATTACH_FILES', 'CONNECT_VOICE', 'SPEAK'];
      for (const p of everyonePerms) {
        await conn.query('INSERT INTO role_permissions (id, role_id, permission_name) VALUES (?, ?, ?)', [
          uuidv4(), everyoneRoleId, p
        ]);
      }
      // Mod permissions
      const modPerms = ['KICK_MEMBERS', 'MANAGE_MESSAGES', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS'];
      for (const p of modPerms) {
        await conn.query('INSERT INTO role_permissions (id, role_id, permission_name) VALUES (?, ?, ?)', [
          uuidv4(), modRoleId, p
        ]);
      }
      // Admin permissions
      await conn.query('INSERT INTO role_permissions (id, role_id, permission_name) VALUES (?, ?, "ADMINISTRATOR")', [
        uuidv4(), adminRoleId
      ]);
      // Owner permissions
      await conn.query('INSERT INTO role_permissions (id, role_id, permission_name) VALUES (?, ?, "ADMINISTRATOR")', [
        uuidv4(), ownerRoleId
      ]);

      // Assign Owner role to creator
      await conn.query(
        'INSERT INTO member_roles (id, server_id, user_id, role_id) VALUES (?, ?, ?, ?)',
        [uuidv4(), serverId, userId, ownerRoleId]
      );

      // 5. Default tags: [DEV], [ADMIN], [STAFF]
      const devTagId = uuidv4();
      const adminTagId = uuidv4();
      const staffTagId = uuidv4();
      await conn.query(
        'INSERT INTO tags (id, server_id, name, color, created_at) VALUES (?, ?, ?, ?, NOW()), (?, ?, ?, ?, NOW()), (?, ?, ?, ?, NOW())',
        [
          devTagId, serverId, 'DEV', '#9b59b6',
          adminTagId, serverId, 'ADMIN', '#e74c3c',
          staffTagId, serverId, 'STAFF', '#3498db'
        ]
      );
      // Give owner the [ADMIN] tag
      await conn.query(
        'INSERT INTO member_tags (id, server_id, user_id, tag_id) VALUES (?, ?, ?, ?)',
        [uuidv4(), serverId, userId, adminTagId]
      );

      // 6. Default Categories
      await conn.query(
        'INSERT INTO channel_categories (id, server_id, name, position, created_at) VALUES (?, ?, ?, 0, NOW()), (?, ?, ?, 1, NOW())',
        [textCatId, serverId, 'SZÖVEGES CSATORNÁK', voiceCatId, serverId, 'HANG CSATORNÁK']
      );

      // 7. Default Channels
      await conn.query(
        'INSERT INTO channels (id, server_id, category_id, name, type, topic, position, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, NOW()), (?, ?, ?, ?, ?, ?, 1, NOW()), (?, ?, ?, ?, ?, ?, 0, NOW())',
        [
          generalChanId, serverId, textCatId, 'általános', 'text', 'Beszélgetés az életről és minden másról',
          announceChanId, serverId, textCatId, 'hírek-értesítések', 'text', 'Fontos szerver hírek és bejelentések',
          voiceChanId, serverId, voiceCatId, 'Hangcsatorna 1', 'voice', null
        ]
      );
    });

    await logAuditEvent({
      serverId,
      actorId: userId,
      action: 'SERVER_CREATE',
      targetId: serverId,
      targetType: 'SERVER',
      metadata: { name: name.trim() }
    });

    const createdServers = await query<Server[]>('SELECT * FROM servers WHERE id = ?', [serverId]);
    res.status(201).json(createdServers[0]);
  } catch (error) {
    console.error('Create server error:', error);
    res.status(500).json({ error: 'Hiba a szerver létrehozásakor' });
  }
});

// Get server details
router.get('/:serverId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user!.id;

    // Verify member
    const membership = await query<any[]>(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?',
      [serverId, userId]
    );

    if (!membership || membership.length === 0) {
      res.status(403).json({ error: 'Nem vagy tagja ennek a szervernek' });
      return;
    }

    const servers = await query<Server[]>('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!servers || servers.length === 0) {
      res.status(404).json({ error: 'Szerver nem található' });
      return;
    }

    const categories = await query<ChannelCategory[]>(
      'SELECT * FROM channel_categories WHERE server_id = ? ORDER BY position ASC, created_at ASC',
      [serverId]
    );

    const channels = await query<Channel[]>(
      'SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC',
      [serverId]
    );

    const roles = await query<Role[]>(
      'SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC',
      [serverId]
    );

    // Attach role permissions
    for (const role of roles) {
      const perms = await query<{ permission_name: string }[]>(
        'SELECT permission_name FROM role_permissions WHERE role_id = ?',
        [role.id]
      );
      role.permissions = perms.map(p => p.permission_name);
    }

    const tags = await query<Tag[]>('SELECT * FROM tags WHERE server_id = ? ORDER BY created_at ASC', [serverId]);

    // Members with their roles and tags
    const members = await query<any[]>(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, u.custom_status, sm.nickname, sm.joined_at
       FROM server_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.server_id = ?`,
      [serverId]
    );

    for (const m of members) {
      const mRoles = await query<Role[]>(
        `SELECT r.* FROM roles r
         JOIN member_roles mr ON mr.role_id = r.id
         WHERE mr.server_id = ? AND mr.user_id = ?
         ORDER BY r.position DESC`,
        [serverId, m.id]
      );
      m.roles = mRoles;

      const mTags = await query<Tag[]>(
        `SELECT t.* FROM tags t
         JOIN member_tags mt ON mt.tag_id = t.id
         WHERE mt.server_id = ? AND mt.user_id = ?`,
        [serverId, m.id]
      );
      m.tags = mTags;
    }

    const isOwner = servers[0].owner_id === userId;
    const canManageServer = await hasPermission(serverId, userId, 'MANAGE_SERVER');
    const canManageRoles = await hasPermission(serverId, userId, 'MANAGE_ROLES');
    const canManageChannels = await hasPermission(serverId, userId, 'MANAGE_CHANNELS');
    const canManageMembers = await hasPermission(serverId, userId, 'MANAGE_MEMBERS');

    res.json({
      server: servers[0],
      categories,
      channels,
      roles,
      tags,
      members,
      currentUserPermissions: {
        isOwner,
        canManageServer,
        canManageRoles,
        canManageChannels,
        canManageMembers
      }
    });
  } catch (error) {
    console.error('Fetch server error:', error);
    res.status(500).json({ error: 'Hiba a szerver adatok lekérésekor' });
  }
});

// Update server settings (PUT & PATCH)
const handleUpdateServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { name, description, icon_url } = req.body;
    const userId = req.user!.id;

    const canEdit = await hasPermission(serverId, userId, 'MANAGE_SERVER');
    if (!canEdit) {
      res.status(403).json({ error: 'Nincs jogosultságod a szerver beállítások módosítására!' });
      return;
    }

    await query(
      `UPDATE servers SET
         name = COALESCE(?, name),
         description = ?,
         icon_url = COALESCE(?, icon_url)
       WHERE id = ?`,
      [name ? name.trim() : null, description !== undefined ? description : null, icon_url || null, serverId]
    );

    await logAuditEvent({
      serverId,
      actorId: userId,
      action: 'SERVER_UPDATE',
      targetId: serverId,
      targetType: 'SERVER',
      metadata: { name, description }
    });

    const updated = await query<Server[]>('SELECT * FROM servers WHERE id = ?', [serverId]);
    res.json(updated[0]);
  } catch (error) {
    console.error('Update server error:', error);
    res.status(500).json({ error: 'Hiba a szerver frissítésekor' });
  }
};

router.put('/:serverId', authenticateToken, handleUpdateServer);
router.patch('/:serverId', authenticateToken, handleUpdateServer);

// Get server members
router.get('/:serverId/members', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user!.id;

    // Verify member
    const membership = await query<any[]>(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?',
      [serverId, userId]
    );

    if (!membership || membership.length === 0) {
      res.status(403).json({ error: 'Nem vagy tagja ennek a szervernek' });
      return;
    }

    const members = await query<any[]>(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, u.custom_status, sm.nickname, sm.joined_at
       FROM server_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.server_id = ?
       ORDER BY sm.joined_at ASC`,
      [serverId]
    );

    for (const m of members) {
      const mRoles = await query<Role[]>(
        `SELECT r.* FROM roles r
         JOIN member_roles mr ON mr.role_id = r.id
         WHERE mr.server_id = ? AND mr.user_id = ?
         ORDER BY r.position DESC`,
        [serverId, m.id]
      );
      m.roles = mRoles;

      const mTags = await query<Tag[]>(
        `SELECT t.* FROM tags t
         JOIN member_tags mt ON mt.tag_id = t.id
         WHERE mt.server_id = ? AND mt.user_id = ?`,
        [serverId, m.id]
      );
      m.tags = mTags;
    }

    res.json(members);
  } catch (error) {
    console.error('Fetch server members error:', error);
    res.status(500).json({ error: 'Hiba a tagok lekérésekor' });
  }
});

// Delete server (Owner only)
router.delete('/:serverId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user!.id;

    const isOwner = await isServerOwner(serverId, userId);
    if (!isOwner) {
      res.status(403).json({ error: 'Csak a szerver tulajdonosa törölheti a szervert!' });
      return;
    }

    await query('DELETE FROM servers WHERE id = ?', [serverId]);
    res.json({ message: 'Szerver sikeresen törölve' });
  } catch (error) {
    console.error('Delete server error:', error);
    res.status(500).json({ error: 'Hiba a szerver törlésekor' });
  }
});

// Leave server
router.post('/:serverId/leave', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user!.id;

    const isOwner = await isServerOwner(serverId, userId);
    if (isOwner) {
      res.status(400).json({ error: 'A tulajdonos nem léphet ki a szerverből! Töröld a szervert, vagy add át a tulajdonjogot.' });
      return;
    }

    await query('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', [serverId, userId]);

    await logAuditEvent({
      serverId,
      actorId: userId,
      action: 'MEMBER_LEAVE',
      targetId: userId,
      targetType: 'USER'
    });

    res.json({ message: 'Sikeresen kiléptél a szerverből' });
  } catch (error) {
    console.error('Leave server error:', error);
    res.status(500).json({ error: 'Hiba a kilépéskor' });
  }
});

// Update member (nickname, roles, tags)
router.put('/:serverId/members/:targetUserId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, targetUserId } = req.params;
    const { nickname, roleIds, tagIds } = req.body;
    const actorId = req.user!.id;

    // Can change own nickname if allowed, or manage members
    const canManage = await hasPermission(serverId, actorId, 'MANAGE_MEMBERS');
    const canManageRoles = await hasPermission(serverId, actorId, 'MANAGE_ROLES');
    const canManageTags = await hasPermission(serverId, actorId, 'MANAGE_TAGS') || canManage;

    if (actorId !== targetUserId && !canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod a tag módosítására!' });
      return;
    }

    // Role hierarchy check if modifying someone else
    if (actorId !== targetUserId) {
      const allowed = await canManageTarget(serverId, actorId, targetUserId);
      if (!allowed) {
        res.status(403).json({ error: 'Nem módosíthatsz nálad egyenlő vagy magasabb rangú tagot!' });
        return;
      }
    }

    // Update nickname
    if (nickname !== undefined) {
      await query(
        'UPDATE server_members SET nickname = ? WHERE server_id = ? AND user_id = ?',
        [nickname ? nickname.trim() : null, serverId, targetUserId]
      );
    }

    // Update roles if permitted
    if (roleIds !== undefined && canManageRoles) {
      const actorPos = await getUserHighestRolePosition(serverId, actorId);
      const isOwner = await isServerOwner(serverId, actorId);

      // Verify that all assigned roles are lower in hierarchy than actor
      const targetRoles = await query<Role[]>(
        `SELECT * FROM roles WHERE server_id = ? AND id IN (${roleIds.length ? roleIds.map(() => '?').join(',') : "''"})`,
        roleIds.length ? roleIds : []
      );

      if (!isOwner) {
        for (const r of targetRoles) {
          if (r.position >= actorPos) {
            res.status(403).json({ error: `Nem adhatsz a saját rangodnál (${actorPos}) magasabb vagy egyenlő rangot: ${r.name}` });
            return;
          }
        }
      }

      await query('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?', [serverId, targetUserId]);
      for (const rId of roleIds) {
        await query(
          'INSERT INTO member_roles (id, server_id, user_id, role_id) VALUES (?, ?, ?, ?)',
          [uuidv4(), serverId, targetUserId, rId]
        );
      }
    }

    // Update tags if permitted
    if (tagIds !== undefined && canManageTags) {
      await query('DELETE FROM member_tags WHERE server_id = ? AND user_id = ?', [serverId, targetUserId]);
      for (const tId of tagIds) {
        await query(
          'INSERT INTO member_tags (id, server_id, user_id, tag_id) VALUES (?, ?, ?, ?)',
          [uuidv4(), serverId, targetUserId, tId]
        );
      }
    }

    await logAuditEvent({
      serverId,
      actorId,
      action: 'MEMBER_UPDATE',
      targetId: targetUserId,
      targetType: 'USER',
      metadata: { nickname, roleIds, tagIds }
    });

    res.json({ message: 'Tag adatai sikeresen frissítve!' });
  } catch (error) {
    console.error('Update member error:', error);
    res.status(500).json({ error: 'Hiba a tag adatainak frissítésekor' });
  }
});

// Kick member
const handleKickMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, targetUserId } = req.params;
    const actorId = req.user!.id;

    const canKick = await hasPermission(serverId, actorId, 'KICK_MEMBERS');
    if (!canKick) {
      res.status(403).json({ error: 'Nincs jogosultságod tagok kirúgására!' });
      return;
    }

    const canManage = await canManageTarget(serverId, actorId, targetUserId);
    if (!canManage) {
      res.status(403).json({ error: 'Nem rúghatsz ki nálad magasabb vagy egyenlő rangú tagot!' });
      return;
    }

    await query('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', [serverId, targetUserId]);

    await logAuditEvent({
      serverId,
      actorId,
      action: 'MEMBER_KICK',
      targetId: targetUserId,
      targetType: 'USER'
    });

    res.json({ message: 'Felhasználó kirúgva' });
  } catch (error) {
    console.error('Kick error:', error);
    res.status(500).json({ error: 'Hiba a tag kirúgásakor' });
  }
};

router.post('/:serverId/kick/:targetUserId', authenticateToken, handleKickMember);
router.post('/:serverId/members/:targetUserId/kick', authenticateToken, handleKickMember);

// Ban member
const handleBanMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, targetUserId } = req.params;
    const { reason } = req.body;
    const actorId = req.user!.id;

    const canBan = await hasPermission(serverId, actorId, 'BAN_MEMBERS');
    if (!canBan) {
      res.status(403).json({ error: 'Nincs jogosultságod tagok kitiltására!' });
      return;
    }

    const canManage = await canManageTarget(serverId, actorId, targetUserId);
    if (!canManage) {
      res.status(403).json({ error: 'Nem tilthatsz ki nálad magasabb vagy egyenlő rangú tagot!' });
      return;
    }

    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', [serverId, targetUserId]);
      await conn.query(
        'INSERT INTO server_bans (id, server_id, user_id, reason, banned_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [uuidv4(), serverId, targetUserId, reason || null, actorId]
      );
    });

    await logAuditEvent({
      serverId,
      actorId,
      action: 'MEMBER_BAN',
      targetId: targetUserId,
      targetType: 'USER',
      metadata: { reason }
    });

    res.json({ message: 'Felhasználó sikeresen kitiltva' });
  } catch (error) {
    console.error('Ban error:', error);
    res.status(500).json({ error: 'Hiba a kitiltás során' });
  }
};

router.post('/:serverId/ban/:targetUserId', authenticateToken, handleBanMember);
router.post('/:serverId/members/:targetUserId/ban', authenticateToken, handleBanMember);

// Unban member
router.delete('/:serverId/ban/:targetUserId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, targetUserId } = req.params;
    const actorId = req.user!.id;

    const canBan = await hasPermission(serverId, actorId, 'BAN_MEMBERS');
    if (!canBan) {
      res.status(403).json({ error: 'Nincs jogosultságod kitiltások kezelésére!' });
      return;
    }

    await query('DELETE FROM server_bans WHERE server_id = ? AND user_id = ?', [serverId, targetUserId]);

    await logAuditEvent({
      serverId,
      actorId,
      action: 'MEMBER_UNBAN',
      targetId: targetUserId,
      targetType: 'USER'
    });

    res.json({ message: 'Kitiltás feloldva' });
  } catch (error) {
    console.error('Unban error:', error);
    res.status(500).json({ error: 'Hiba a feloldás során' });
  }
});

// List bans
router.get('/:serverId/bans', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const actorId = req.user!.id;

    const canBan = await hasPermission(serverId, actorId, 'BAN_MEMBERS');
    if (!canBan) {
      res.status(403).json({ error: 'Nincs jogosultságod a kitiltások megtekintésére' });
      return;
    }

    const bans = await query<any[]>(
      `SELECT b.*, u.username, u.display_name, u.avatar_url, bby.username as banner_username
       FROM server_bans b
       JOIN users u ON u.id = b.user_id
       JOIN users bby ON bby.id = b.banned_by
       WHERE b.server_id = ?
       ORDER BY b.created_at DESC`,
      [serverId]
    );

    res.json(bans);
  } catch (error) {
    console.error('Fetch bans error:', error);
    res.status(500).json({ error: 'Hiba a kitiltások lekérésekor' });
  }
});

// Audit log viewer
router.get('/:serverId/audit-log', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const actorId = req.user!.id;

    const canView = await hasPermission(serverId, actorId, 'MANAGE_SERVER');
    if (!canView) {
      res.status(403).json({ error: 'Nincs jogosultságod az audit log megtekintésére' });
      return;
    }

    const logs = await query<any[]>(
      `SELECT al.*, u.username as actor_username, u.display_name as actor_display_name, u.avatar_url as actor_avatar
       FROM audit_logs al
       JOIN users u ON u.id = al.actor_id
       WHERE al.server_id = ?
       ORDER BY al.created_at DESC
       LIMIT 100`,
      [serverId]
    );

    res.json(logs.map(l => ({
      ...l,
      metadata: typeof l.metadata === 'string' ? JSON.parse(l.metadata) : l.metadata
    })));
  } catch (error) {
    console.error('Fetch audit log error:', error);
    res.status(500).json({ error: 'Hiba az audit log lekérésekor' });
  }
});

export default router;
