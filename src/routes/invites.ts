import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { hasPermission, isServerOwner } from '../services/permissionService.js';
import { logAuditEvent } from '../services/auditService.js';

const router = Router();

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Create invite
const handleCreateInvite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const serverId = req.params.serverId || req.params.id;
    const { max_uses, expires_hours } = req.body;
    const userId = req.user!.id;

    const isOwner = await isServerOwner(serverId, userId);
    const memberRows = await query<any[]>(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?',
      [serverId, userId]
    );

    if (!isOwner && (!memberRows || memberRows.length === 0)) {
      res.status(403).json({ error: 'Csak a szerver tagjai hozhatnak létre meghívót!' });
      return;
    }

    const code = generateInviteCode();
    const inviteId = uuidv4();
    let expiresAt: Date | null = null;
    if (expires_hours && Number(expires_hours) > 0) {
      expiresAt = new Date(Date.now() + Number(expires_hours) * 3600 * 1000);
    }

    await query(
      `INSERT INTO invites (id, code, server_id, inviter_id, max_uses, uses, is_revoked, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, FALSE, ?, NOW())`,
      [inviteId, code, serverId, userId, max_uses ? Number(max_uses) : 0, expiresAt]
    );

    await logAuditEvent({
      serverId,
      actorId: userId,
      action: 'INVITE_CREATE',
      targetId: inviteId,
      targetType: 'INVITE',
      metadata: { code, max_uses, expires_hours }
    });

    res.status(201).json({
      id: inviteId,
      code,
      server_id: serverId,
      max_uses: max_uses || 0,
      uses: 0,
      expires_at: expiresAt
    });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ error: 'Hiba a meghívó létrehozásakor' });
  }
};

router.post('/servers/:serverId', authenticateToken, handleCreateInvite);
router.post('/servers/:serverId/invites', authenticateToken, handleCreateInvite);
router.post('/:serverId/invites', authenticateToken, handleCreateInvite);
router.post('/:serverId', authenticateToken, handleCreateInvite);

function extractCleanCode(raw: string): string {
  let clean = (raw || '').trim().replace(/\/+$/, '');
  if (clean.includes('/')) {
    const parts = clean.split('/');
    clean = parts[parts.length - 1];
  }
  return clean.trim().toUpperCase();
}

// Get invite preview info
router.get('/:code', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const cleanCode = extractCleanCode(req.params.code);
    const invites = await query<any[]>(
      `SELECT i.*, s.name as server_name, s.icon_url, s.description, u.username as inviter_username
       FROM invites i
       JOIN servers s ON s.id = i.server_id
       JOIN users u ON u.id = i.inviter_id
       WHERE UPPER(TRIM(i.code)) = ?`,
      [cleanCode]
    );

    if (!invites || invites.length === 0) {
      res.status(404).json({ error: 'Érvénytelen vagy nem létező meghívókód!' });
      return;
    }

    const inv = invites[0];

    // Check revoked
    if (inv.is_revoked) {
      res.status(410).json({ error: 'Ez a meghívó vissza lett vonva!' });
      return;
    }

    // Check expiration
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      res.status(410).json({ error: 'Ez a meghívó már lejárt!' });
      return;
    }

    // Check max uses
    if (inv.max_uses > 0 && inv.uses >= inv.max_uses) {
      res.status(410).json({ error: 'Ez a meghívó elérte a maximális felhasználási limitet!' });
      return;
    }

    // Member count
    const countRes = await query<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM server_members WHERE server_id = ?',
      [inv.server_id]
    );

    res.json({
      code: inv.code,
      server: {
        id: inv.server_id,
        name: inv.server_name,
        icon_url: inv.icon_url,
        description: inv.description,
        memberCount: countRes[0]?.count || 0
      },
      inviter: {
        username: inv.inviter_username
      }
    });
  } catch (error) {
    console.error('Get invite error:', error);
    res.status(500).json({ error: 'Hiba a meghívó ellenőrzésekor' });
  }
});

// Join server via invite
router.post('/:code/join', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const cleanCode = extractCleanCode(req.params.code);
    const userId = req.user!.id;

    const invites = await query<any[]>(
      'SELECT * FROM invites WHERE UPPER(TRIM(code)) = ?',
      [cleanCode]
    );

    if (!invites || invites.length === 0) {
      res.status(404).json({ error: 'Érvénytelen vagy nem létező meghívókód!' });
      return;
    }

    const inv = invites[0];

    // Check revoked
    if (inv.is_revoked) {
      res.status(410).json({ error: 'Ez a meghívó vissza lett vonva!' });
      return;
    }

    // Check expiration
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      res.status(410).json({ error: 'Ez a meghívó már lejárt!' });
      return;
    }

    // Check max uses
    if (inv.max_uses > 0 && inv.uses >= inv.max_uses) {
      res.status(410).json({ error: 'Ez a meghívó már nem használható!' });
      return;
    }

    // Check if banned
    const isBanned = await query<any[]>(
      'SELECT id FROM server_bans WHERE server_id = ? AND user_id = ?',
      [inv.server_id, userId]
    );
    if (isBanned && isBanned.length > 0) {
      res.status(403).json({ error: 'Ki vagy tiltva ebből a szerverből!' });
      return;
    }

    // Check if already a member
    const existingMember = await query<any[]>(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?',
      [inv.server_id, userId]
    );
    if (existingMember && existingMember.length > 0) {
      res.status(400).json({ error: 'Már tagja vagy ennek a szervernek!' });
      return;
    }

    await withTransaction(async (conn) => {
      // Add member
      await conn.query(
        'INSERT INTO server_members (id, server_id, user_id, joined_at) VALUES (?, ?, ?, NOW())',
        [uuidv4(), inv.server_id, userId]
      );

      // Increment uses
      await conn.query('UPDATE invites SET uses = uses + 1 WHERE id = ?', [inv.id]);
    });

    await logAuditEvent({
      serverId: inv.server_id,
      actorId: userId,
      action: 'MEMBER_JOIN',
      targetId: userId,
      targetType: 'USER',
      metadata: { inviteCode: cleanCode }
    });

    const serverRows = await query<any[]>('SELECT * FROM servers WHERE id = ?', [inv.server_id]);
    res.json({
      message: 'Sikeresen csatlakoztál a szerverhez!',
      server: serverRows[0]
    });
  } catch (error) {
    console.error('Join via invite error:', error);
    res.status(500).json({ error: 'Hiba a szerverhez csatlakozáskor' });
  }
});

// List server invites
const handleListInvites = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user!.id;

    const canManage = await hasPermission(serverId, userId, 'MANAGE_INVITES') ||
                      await hasPermission(serverId, userId, 'MANAGE_SERVER');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod a meghívók listázására!' });
      return;
    }

    const invites = await query<any[]>(
      `SELECT i.*, u.username as inviter_username
       FROM invites i
       JOIN users u ON u.id = i.inviter_id
       WHERE i.server_id = ?
       ORDER BY i.created_at DESC`,
      [serverId]
    );

    res.json(invites);
  } catch (error) {
    console.error('List invites error:', error);
    res.status(500).json({ error: 'Hiba a meghívók lekérésekor' });
  }
};

router.get('/servers/:serverId/list', authenticateToken, handleListInvites);
router.get('/servers/:serverId/invites', authenticateToken, handleListInvites);
router.get('/:serverId/invites', authenticateToken, handleListInvites);

// Revoke invite
router.delete('/:code', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { code } = req.params;
    const userId = req.user!.id;

    const invites = await query<any[]>('SELECT * FROM invites WHERE code = ?', [code.trim().toUpperCase()]);
    if (!invites || invites.length === 0) {
      res.status(404).json({ error: 'A meghívó nem található' });
      return;
    }

    const inv = invites[0];
    const canManage = await hasPermission(inv.server_id, userId, 'MANAGE_INVITES') ||
                      await hasPermission(inv.server_id, userId, 'MANAGE_SERVER');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod a meghívó visszavonására' });
      return;
    }

    await query('DELETE FROM invites WHERE id = ?', [inv.id]);

    await logAuditEvent({
      serverId: inv.server_id,
      actorId: userId,
      action: 'INVITE_REVOKE',
      targetId: inv.id,
      targetType: 'INVITE',
      metadata: { code }
    });

    res.json({ message: 'Meghívó sikeresen visszavonva' });
  } catch (error) {
    console.error('Revoke invite error:', error);
    res.status(500).json({ error: 'Hiba a meghívó visszavonásakor' });
  }
});

export default router;
