import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { hasPermission } from '../services/permissionService.js';
import { logAuditEvent } from '../services/auditService.js';
import { Tag } from '../types/index.js';

const router = Router();

// Get tags
router.get('/:serverId/tags', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const tags = await query<Tag[]>('SELECT * FROM tags WHERE server_id = ? ORDER BY created_at ASC', [serverId]);
    res.json(tags);
  } catch (error) {
    console.error('Fetch tags error:', error);
    res.status(500).json({ error: 'Hiba a tagek lekérésekor' });
  }
});

// Create tag
router.post('/:serverId/tags', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { name, color } = req.body;
    const actorId = req.user!.id;

    const canManageTags = await hasPermission(serverId, actorId, 'MANAGE_TAGS') ||
                          await hasPermission(serverId, actorId, 'MANAGE_SERVER');
    if (!canManageTags) {
      res.status(403).json({ error: 'Nincs jogosultságod szerver tagek kezelésére!' });
      return;
    }

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'A tag neve nem lehet üres!' });
      return;
    }

    const tagId = uuidv4();
    const cleanName = name.trim().toUpperCase().slice(0, 16);

    await query(
      'INSERT INTO tags (id, server_id, name, color, created_at) VALUES (?, ?, ?, ?, NOW())',
      [tagId, serverId, cleanName, color || '#3ba55d']
    );

    await logAuditEvent({
      serverId,
      actorId,
      action: 'TAG_CREATE',
      targetId: tagId,
      targetType: 'TAG',
      metadata: { name: cleanName, color }
    });

    const created = await query<Tag[]>('SELECT * FROM tags WHERE id = ?', [tagId]);
    res.status(201).json(created[0]);
  } catch (error) {
    console.error('Create tag error:', error);
    res.status(500).json({ error: 'Hiba a tag létrehozásakor' });
  }
});

// Update tag (PUT & PATCH)
const handleUpdateTag = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, tagId } = req.params;
    const { name, color } = req.body;
    const actorId = req.user!.id;

    const canManageTags = await hasPermission(serverId, actorId, 'MANAGE_TAGS') ||
                          await hasPermission(serverId, actorId, 'MANAGE_SERVER');
    if (!canManageTags) {
      res.status(403).json({ error: 'Nincs jogosultságod szerver tagek kezelésére!' });
      return;
    }

    await query(
      `UPDATE tags SET
         name = COALESCE(?, name),
         color = COALESCE(?, color)
       WHERE id = ? AND server_id = ?`,
      [name ? name.trim().toUpperCase().slice(0, 16) : null, color || null, tagId, serverId]
    );

    await logAuditEvent({
      serverId,
      actorId,
      action: 'TAG_UPDATE',
      targetId: tagId,
      targetType: 'TAG',
      metadata: { name, color }
    });

    const updated = await query<Tag[]>('SELECT * FROM tags WHERE id = ?', [tagId]);
    res.json(updated[0]);
  } catch (error) {
    console.error('Update tag error:', error);
    res.status(500).json({ error: 'Hiba a tag módosításakor' });
  }
};

router.put('/:serverId/tags/:tagId', authenticateToken, handleUpdateTag);
router.patch('/:serverId/tags/:tagId', authenticateToken, handleUpdateTag);

// Delete tag
router.delete('/:serverId/tags/:tagId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, tagId } = req.params;
    const actorId = req.user!.id;

    const canManageTags = await hasPermission(serverId, actorId, 'MANAGE_TAGS') ||
                          await hasPermission(serverId, actorId, 'MANAGE_SERVER');
    if (!canManageTags) {
      res.status(403).json({ error: 'Nincs jogosultságod szerver tagek törlésére!' });
      return;
    }

    await query('DELETE FROM tags WHERE id = ? AND server_id = ?', [tagId, serverId]);

    await logAuditEvent({
      serverId,
      actorId,
      action: 'TAG_DELETE',
      targetId: tagId,
      targetType: 'TAG'
    });

    res.json({ message: 'Tag sikeresen törölve' });
  } catch (error) {
    console.error('Delete tag error:', error);
    res.status(500).json({ error: 'Hiba a tag törlésekor' });
  }
});

// Assign tag to member
router.post('/:serverId/members/:userId/tags/:tagId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, userId, tagId } = req.params;
    const actorId = req.user!.id;

    const canManageTags = await hasPermission(serverId, actorId, 'MANAGE_TAGS') ||
                          await hasPermission(serverId, actorId, 'MANAGE_SERVER');
    if (!canManageTags) {
      res.status(403).json({ error: 'Nincs jogosultságod tagek hozzárendeléséhez!' });
      return;
    }

    await query(
      'INSERT IGNORE INTO member_tags (id, server_id, user_id, tag_id) VALUES (?, ?, ?, ?)',
      [uuidv4(), serverId, userId, tagId]
    );

    res.json({ message: 'Tag sikeresen hozzárendelve a felhasználóhoz' });
  } catch (error) {
    console.error('Assign tag error:', error);
    res.status(500).json({ error: 'Hiba a tag hozzárendelésekor' });
  }
});

// Remove tag from member
router.delete('/:serverId/members/:userId/tags/:tagId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, userId, tagId } = req.params;
    const actorId = req.user!.id;

    const canManageTags = await hasPermission(serverId, actorId, 'MANAGE_TAGS') ||
                          await hasPermission(serverId, actorId, 'MANAGE_SERVER');
    if (!canManageTags) {
      res.status(403).json({ error: 'Nincs jogosultságod tagek kezelésére!' });
      return;
    }

    await query(
      'DELETE FROM member_tags WHERE server_id = ? AND user_id = ? AND tag_id = ?',
      [serverId, userId, tagId]
    );

    res.json({ message: 'Tag eltávolítva a felhasználótól' });
  } catch (error) {
    console.error('Remove tag error:', error);
    res.status(500).json({ error: 'Hiba a tag eltávolításakor' });
  }
});

export default router;
