import { Router, Response } from 'express';
import { query } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';

const router = Router();

// Search messages, channels, or users
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const q = (req.query.q as string || '').trim();
    const serverId = req.query.serverId as string | undefined;
    const channelId = req.query.channelId as string | undefined;
    const type = req.query.type as string || 'messages'; // 'messages' | 'channels' | 'users'
    const userId = req.user!.id;

    if (!q) {
      res.json({ results: [] });
      return;
    }

    if (type === 'messages') {
      let sql = `SELECT m.*, u.username as sender_username, u.display_name as sender_display_name, u.avatar_url as sender_avatar, c.name as channel_name
                 FROM messages m
                 JOIN users u ON u.id = m.sender_id
                 LEFT JOIN channels c ON c.id = m.channel_id
                 WHERE m.content LIKE ?`;
      const params: any[] = [`%${q}%`];

      if (channelId) {
        sql += ' AND m.channel_id = ?';
        params.push(channelId);
      } else if (serverId) {
        sql += ' AND c.server_id = ?';
        params.push(serverId);
      } else {
        // Only return messages from servers user is in or DMs user is involved in
        sql += ` AND (
          m.channel_id IN (SELECT ch.id FROM channels ch JOIN server_members sm ON sm.server_id = ch.server_id WHERE sm.user_id = ?)
          OR m.sender_id = ? OR m.dm_recipient_id = ?
        )`;
        params.push(userId, userId, userId);
      }

      sql += ' ORDER BY m.created_at DESC LIMIT 30';
      const results = await query<any[]>(sql, params);
      res.json({ results });
      return;
    }

    if (type === 'channels' && serverId) {
      const results = await query<any[]>(
        'SELECT * FROM channels WHERE server_id = ? AND name LIKE ? LIMIT 20',
        [serverId, `%${q}%`]
      );
      res.json({ results });
      return;
    }

    if (type === 'users') {
      const results = await query<any[]>(
        'SELECT id, username, display_name, avatar_url, status FROM users WHERE (username LIKE ? OR display_name LIKE ?) LIMIT 20',
        [`%${q}%`, `%${q}%`]
      );
      res.json({ results });
      return;
    }

    res.json({ results: [] });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Hiba a keresés során' });
  }
});

export default router;
