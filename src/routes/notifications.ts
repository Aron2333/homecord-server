import { Router, Response } from 'express';
import { query } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';

const router = Router();

// GET /api/notifications - List user notifications
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const notifications = await query<any[]>(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    sendSuccess(res, notifications);
  } catch (err: any) {
    console.error('Fetch notifications error:', err);
    sendError(res, 'FETCH_NOTIFICATIONS_FAILED', 'Nem sikerült betölteni az értesítéseket.', 500);
  }
});

// POST /api/notifications/:id/read - Mark single notification as read
router.post('/:id/read', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    await query(
      `UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    sendSuccess(res, { message: 'Értesítés olvasottnak jelölve.' });
  } catch (err: any) {
    console.error('Mark notification read error:', err);
    sendError(res, 'UPDATE_NOTIFICATION_FAILED', 'Nem sikerült frissíteni az értesítést.', 500);
  }
});

// POST /api/notifications/read-all - Mark all notifications as read
router.post('/read-all', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    await query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE`,
      [userId]
    );

    sendSuccess(res, { message: 'Összes értesítés olvasottnak jelölve.' });
  } catch (err: any) {
    console.error('Mark all read error:', err);
    sendError(res, 'UPDATE_ALL_NOTIFICATIONS_FAILED', 'Nem sikerült az összes értesítést olvasottnak jelölni.', 500);
  }
});

export default router;
