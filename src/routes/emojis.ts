import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { uploadMiddleware } from '../middlewares/upload.js';
import { hasPermission } from '../services/permissionService.js';
import { logAuditEvent } from '../services/auditService.js';

const router = Router();

// Get server emojis
const handleGetEmojis = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const emojis = await query<any[]>('SELECT * FROM emojis WHERE server_id = ? ORDER BY created_at ASC', [serverId]);
    res.json(emojis);
  } catch (error) {
    console.error('Fetch emojis error:', error);
    res.status(500).json({ error: 'Hiba az emojik lekérésekor' });
  }
};

router.get('/:serverId', authenticateToken, handleGetEmojis);
router.get('/:serverId/emojis', authenticateToken, handleGetEmojis);

// Upload server emoji
const handleUploadEmoji = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { name } = req.body;
    const file = req.file;
    const userId = req.user!.id;

    const canManage = await hasPermission(serverId, userId, 'MANAGE_SERVER');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod emojik feltöltésére!' });
      return;
    }

    if (!file || !name || !name.trim()) {
      res.status(400).json({ error: 'Kép és emoji név megadása kötelező!' });
      return;
    }

    const emojiId = uuidv4();
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    const imageUrl = `/uploads/${file.filename}`;

    await query(
      'INSERT INTO emojis (id, server_id, name, image_url, created_at) VALUES (?, ?, ?, ?, NOW())',
      [emojiId, serverId, cleanName, imageUrl]
    );

    await logAuditEvent({
      serverId,
      actorId: userId,
      action: 'EMOJI_CREATE',
      targetId: emojiId,
      targetType: 'EMOJI',
      metadata: { name: cleanName }
    });

    const created = await query<any[]>('SELECT * FROM emojis WHERE id = ?', [emojiId]);
    res.status(201).json(created[0]);
  } catch (error) {
    console.error('Upload emoji error:', error);
    res.status(500).json({ error: 'Hiba az emoji feltöltésekor' });
  }
};

router.post('/:serverId', authenticateToken, uploadMiddleware.single('image'), handleUploadEmoji);
router.post('/:serverId/emojis', authenticateToken, uploadMiddleware.single('image'), handleUploadEmoji);

// Delete emoji
const handleDeleteEmoji = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, emojiId } = req.params;
    const userId = req.user!.id;

    const canManage = await hasPermission(serverId, userId, 'MANAGE_SERVER');
    if (!canManage) {
      res.status(403).json({ error: 'Nincs jogosultságod az emoji törlésére!' });
      return;
    }

    await query('DELETE FROM emojis WHERE id = ? AND server_id = ?', [emojiId, serverId]);

    await logAuditEvent({
      serverId,
      actorId: userId,
      action: 'EMOJI_DELETE',
      targetId: emojiId,
      targetType: 'EMOJI'
    });

    res.json({ message: 'Emoji sikeresen törölve' });
  } catch (error) {
    console.error('Delete emoji error:', error);
    res.status(500).json({ error: 'Hiba az emoji törlésekor' });
  }
};

router.delete('/:serverId/:emojiId', authenticateToken, handleDeleteEmoji);
router.delete('/:serverId/emojis/:emojiId', authenticateToken, handleDeleteEmoji);

export default router;
