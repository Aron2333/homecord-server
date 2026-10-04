import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { uploadMiddleware } from '../middlewares/upload.js';
import { hasPermission } from '../services/permissionService.js';
import { logAuditEvent } from '../services/auditService.js';

const router = Router();

// Get server stickers
const handleGetStickers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const stickers = await query<any[]>('SELECT * FROM stickers WHERE server_id = ? ORDER BY created_at ASC', [serverId]);
    res.json(stickers);
  } catch (error) {
    console.error('Fetch stickers error:', error);
    res.status(500).json({ error: 'Hiba a matricák lekérésekor' });
  }
};

router.get('/:serverId', authenticateToken, handleGetStickers);
router.get('/:serverId/stickers', authenticateToken, handleGetStickers);

// Upload server sticker
const handleUploadSticker = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { name } = req.body;
    const file = req.file;
    const userId = req.user!.id;

    const canManage = await hasPermission(serverId, userId, 'MANAGE_SERVER');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod matricák feltöltésére!' });
      return;
    }

    if (!file || !name || !name.trim()) {
      res.status(400).json({ error: 'Kép és matrica név megadása kötelező!' });
      return;
    }

    const stickerId = uuidv4();
    const cleanName = name.trim();
    const imageUrl = `/uploads/${file.filename}`;

    await query(
      'INSERT INTO stickers (id, server_id, name, image_url, created_at) VALUES (?, ?, ?, ?, NOW())',
      [stickerId, serverId, cleanName, imageUrl]
    );

    await logAuditEvent({
      serverId,
      actorId: userId,
      action: 'STICKER_CREATE',
      targetId: stickerId,
      targetType: 'STICKER',
      metadata: { name: cleanName }
    });

    const created = await query<any[]>('SELECT * FROM stickers WHERE id = ?', [stickerId]);
    res.status(201).json(created[0]);
  } catch (error) {
    console.error('Upload sticker error:', error);
    res.status(500).json({ error: 'Hiba a matrica feltöltésekor' });
  }
};

router.post('/:serverId', authenticateToken, uploadMiddleware.single('image'), handleUploadSticker);
router.post('/:serverId/stickers', authenticateToken, uploadMiddleware.single('image'), handleUploadSticker);

// Delete sticker
const handleDeleteSticker = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, stickerId } = req.params;
    const userId = req.user!.id;

    const canManage = await hasPermission(serverId, userId, 'MANAGE_SERVER');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod a matrica törlésére!' });
      return;
    }

    await query('DELETE FROM stickers WHERE id = ? AND server_id = ?', [stickerId, serverId]);

    await logAuditEvent({
      serverId,
      actorId: userId,
      action: 'STICKER_DELETE',
      targetId: stickerId,
      targetType: 'STICKER'
    });

    res.json({ message: 'Matrica sikeresen törölve' });
  } catch (error) {
    console.error('Delete sticker error:', error);
    res.status(500).json({ error: 'Hiba a matrica törlésekor' });
  }
};

router.delete('/:serverId/:stickerId', authenticateToken, handleDeleteSticker);
router.delete('/:serverId/stickers/:stickerId', authenticateToken, handleDeleteSticker);

export default router;
