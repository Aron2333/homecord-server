import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { hasPermission } from '../services/permissionService.js';
import { logAuditEvent } from '../services/auditService.js';
import { Channel, ChannelCategory } from '../types/index.js';

const router = Router();

// Create category
router.post('/:serverId/categories', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { name } = req.body;
    const actorId = req.user!.id;

    const canManage = await hasPermission(serverId, actorId, 'MANAGE_CHANNELS');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod kategória létrehozásához!' });
      return;
    }

    const catId = uuidv4();
    const countRes = await query<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM channel_categories WHERE server_id = ?',
      [serverId]
    );
    const position = countRes[0]?.count || 0;

    await query(
      'INSERT INTO channel_categories (id, server_id, name, position, created_at) VALUES (?, ?, ?, ?, NOW())',
      [catId, serverId, (name || 'ÚJ KATEGÓRIA').trim().toUpperCase(), position]
    );

    await logAuditEvent({
      serverId,
      actorId,
      action: 'CATEGORY_CREATE',
      targetId: catId,
      targetType: 'CATEGORY',
      metadata: { name }
    });

    const created = await query<ChannelCategory[]>('SELECT * FROM channel_categories WHERE id = ?', [catId]);
    res.status(201).json(created[0]);
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Hiba a kategória létrehozásakor' });
  }
});

// Update category
router.put('/:serverId/categories/:categoryId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, categoryId } = req.params;
    const { name, position } = req.body;
    const actorId = req.user!.id;

    const canManage = await hasPermission(serverId, actorId, 'MANAGE_CHANNELS');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod kategóriák módosítására!' });
      return;
    }

    await query(
      `UPDATE channel_categories SET
         name = COALESCE(?, name),
         position = COALESCE(?, position)
       WHERE id = ? AND server_id = ?`,
      [name ? name.trim().toUpperCase() : null, position !== undefined ? position : null, categoryId, serverId]
    );

    await logAuditEvent({
      serverId,
      actorId,
      action: 'CATEGORY_UPDATE',
      targetId: categoryId,
      targetType: 'CATEGORY',
      metadata: { name, position }
    });

    const updated = await query<ChannelCategory[]>('SELECT * FROM channel_categories WHERE id = ?', [categoryId]);
    res.json(updated[0]);
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Hiba a kategória módosításakor' });
  }
});

// Delete category
router.delete('/:serverId/categories/:categoryId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, categoryId } = req.params;
    const actorId = req.user!.id;

    const canManage = await hasPermission(serverId, actorId, 'MANAGE_CHANNELS');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod kategóriák törlésére!' });
      return;
    }

    await query('DELETE FROM channel_categories WHERE id = ? AND server_id = ?', [categoryId, serverId]);

    await logAuditEvent({
      serverId,
      actorId,
      action: 'CATEGORY_DELETE',
      targetId: categoryId,
      targetType: 'CATEGORY'
    });

    res.json({ message: 'Kategória törölve' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Hiba a kategória törlésekor' });
  }
});

// Create channel
router.post('/:serverId/channels', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { name, type, category_id, topic } = req.body;
    const actorId = req.user!.id;

    const canManage = await hasPermission(serverId, actorId, 'MANAGE_CHANNELS');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod csatorna létrehozásához!' });
      return;
    }

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'A csatorna neve nem lehet üres!' });
      return;
    }

    const channelId = uuidv4();
    const cleanName = type === 'voice'
      ? name.trim()
      : name.trim().toLowerCase().replace(/\s+/g, '-');

    const countRes = await query<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM channels WHERE server_id = ? AND category_id <=> ?',
      [serverId, category_id || null]
    );
    const position = countRes[0]?.count || 0;

    await query(
      `INSERT INTO channels (id, server_id, category_id, name, type, topic, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [channelId, serverId, category_id || null, cleanName, type === 'voice' ? 'voice' : 'text', topic || null, position]
    );

    await logAuditEvent({
      serverId,
      actorId,
      action: 'CHANNEL_CREATE',
      targetId: channelId,
      targetType: 'CHANNEL',
      metadata: { name: cleanName, type: type || 'text' }
    });

    const created = await query<Channel[]>('SELECT * FROM channels WHERE id = ?', [channelId]);
    res.status(201).json(created[0]);
  } catch (error) {
    console.error('Create channel error:', error);
    res.status(500).json({ error: 'Hiba a csatorna létrehozásakor' });
  }
});

// Get server channels
router.get('/:serverId/channels', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const channels = await query<Channel[]>('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC', [serverId]);
    const categories = await query<ChannelCategory[]>('SELECT * FROM channel_categories WHERE server_id = ? ORDER BY position ASC', [serverId]);
    res.json({ categories, channels });
  } catch (error) {
    console.error('Fetch channels error:', error);
    res.status(500).json({ error: 'Hiba a csatornák lekérésekor' });
  }
});

// Update channel handler
const handleUpdateChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId || req.params.id;
    const { name, topic, category_id, position } = req.body;
    const actorId = req.user!.id;

    // Look up channel to get server_id if not in params
    const channelRows = await query<Channel[]>('SELECT * FROM channels WHERE id = ?', [channelId]);
    if (!channelRows || channelRows.length === 0) {
      res.status(404).json({ error: 'A csatorna nem található!' });
      return;
    }
    const serverId = req.params.serverId || channelRows[0].server_id;

    const canManage = await hasPermission(serverId, actorId, 'MANAGE_CHANNELS');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod a csatorna módosításához!' });
      return;
    }

    await query(
      `UPDATE channels SET
         name = COALESCE(?, name),
         topic = ?,
         category_id = ?,
         position = COALESCE(?, position)
       WHERE id = ?`,
      [
        name ? name.trim().toLowerCase().replace(/\s+/g, '-') : null,
        topic !== undefined ? topic : null,
        category_id !== undefined ? category_id : null,
        position !== undefined ? position : null,
        channelId
      ]
    );

    await logAuditEvent({
      serverId,
      actorId,
      action: 'CHANNEL_UPDATE',
      targetId: channelId,
      targetType: 'CHANNEL',
      metadata: { name, topic }
    });

    const updated = await query<Channel[]>('SELECT * FROM channels WHERE id = ?', [channelId]);
    res.json(updated[0]);
  } catch (error) {
    console.error('Update channel error:', error);
    res.status(500).json({ error: 'Hiba a csatorna módosításakor' });
  }
};

router.put('/:serverId/channels/:channelId', authenticateToken, handleUpdateChannel);
router.patch('/:serverId/channels/:channelId', authenticateToken, handleUpdateChannel);
router.put('/:channelId', authenticateToken, handleUpdateChannel);
router.patch('/:channelId', authenticateToken, handleUpdateChannel);

// Update channel position
const handleUpdateChannelPosition = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId || req.params.id;
    const { position, category_id } = req.body;
    const actorId = req.user!.id;

    const channelRows = await query<Channel[]>('SELECT * FROM channels WHERE id = ?', [channelId]);
    if (!channelRows || channelRows.length === 0) {
      res.status(404).json({ error: 'A csatorna nem található!' });
      return;
    }
    const serverId = channelRows[0].server_id;

    const canManage = await hasPermission(serverId, actorId, 'MANAGE_CHANNELS');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod a csatorna pozíciójának módosításához!' });
      return;
    }

    await query(
      `UPDATE channels SET
         position = COALESCE(?, position),
         category_id = COALESCE(?, category_id)
       WHERE id = ?`,
      [position !== undefined ? position : null, category_id !== undefined ? category_id : null, channelId]
    );

    const updated = await query<Channel[]>('SELECT * FROM channels WHERE id = ?', [channelId]);
    res.json(updated[0]);
  } catch (error) {
    console.error('Update channel position error:', error);
    res.status(500).json({ error: 'Hiba a csatorna pozíciójának módosításakor' });
  }
};

router.patch('/:channelId/position', authenticateToken, handleUpdateChannelPosition);
router.put('/:channelId/position', authenticateToken, handleUpdateChannelPosition);

// Delete channel
const handleDeleteChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId || req.params.id;
    const actorId = req.user!.id;

    const channelRows = await query<Channel[]>('SELECT * FROM channels WHERE id = ?', [channelId]);
    if (!channelRows || channelRows.length === 0) {
      res.status(404).json({ error: 'A csatorna nem található!' });
      return;
    }
    const serverId = req.params.serverId || channelRows[0].server_id;

    const canManage = await hasPermission(serverId, actorId, 'MANAGE_CHANNELS');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod a csatorna törléséhez!' });
      return;
    }

    await query('DELETE FROM channels WHERE id = ?', [channelId]);

    await logAuditEvent({
      serverId,
      actorId,
      action: 'CHANNEL_DELETE',
      targetId: channelId,
      targetType: 'CHANNEL'
    });

    res.json({ message: 'Csatorna sikeresen törölve' });
  } catch (error) {
    console.error('Delete channel error:', error);
    res.status(500).json({ error: 'Hiba a csatorna törlésekor' });
  }
};

router.delete('/:serverId/channels/:channelId', authenticateToken, handleDeleteChannel);
router.delete('/:channelId', authenticateToken, handleDeleteChannel);

export default router;
