import { Router, Response } from 'express';
import { query } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { uploadMiddleware } from '../middlewares/upload.js';
import { User, UserPublic } from '../types/index.js';

const router = Router();

function formatUser(u: any): UserPublic {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    banner_color: u.banner_color || '#5865F2',
    bio: u.bio,
    custom_status: u.custom_status,
    status: u.status || 'offline',
    badges: typeof u.badges === 'string' ? JSON.parse(u.badges) : u.badges || [],
    created_at: u.created_at
  };
}

// Get current user profile
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const users = await query<User[]>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!users || users.length === 0) {
      res.status(404).json({ error: 'Felhasználó nem található' });
      return;
    }
    res.json(formatUser(users[0]));
  } catch (error) {
    console.error('Fetch me error:', error);
    res.status(500).json({ error: 'Hiba a profil betöltésekor' });
  }
});

// Update current user profile (PATCH /me & PUT /me)
const handleUpdateProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { display_name, username, bio, custom_status, banner_color, avatar_url } = req.body;
    const userId = req.user!.id;

    // Check username uniqueness if changing
    if (username && username.trim() !== req.user!.username) {
      const existing = await query<User[]>(
        'SELECT id FROM users WHERE username = ? AND id != ?',
        [username.trim(), userId]
      );
      if (existing && existing.length > 0) {
        res.status(400).json({ error: 'Ez a felhasználónév már foglalt!' });
        return;
      }
    }

    await query(
      `UPDATE users SET
         display_name = COALESCE(?, display_name),
         username = COALESCE(?, username),
         bio = ?,
         custom_status = ?,
         banner_color = COALESCE(?, banner_color),
         avatar_url = COALESCE(?, avatar_url)
       WHERE id = ?`,
      [
        display_name ? display_name.trim() : null,
        username ? username.trim() : null,
        bio !== undefined ? bio : req.user!.bio,
        custom_status !== undefined ? custom_status : req.user!.custom_status,
        banner_color || null,
        avatar_url !== undefined ? avatar_url : req.user!.avatar_url,
        userId
      ]
    );

    const updated = await query<User[]>('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ user: formatUser(updated[0]) });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Hiba a profil mentése közben' });
  }
};

router.patch('/me', authenticateToken, handleUpdateProfile);
router.put('/me', authenticateToken, handleUpdateProfile);
router.put('/profile', authenticateToken, handleUpdateProfile);

// Update status (PATCH /me/status & PUT /me/status & PUT /status)
const handleUpdateStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, custom_status } = req.body;
    const allowed = ['online', 'idle', 'dnd', 'invisible', 'offline'];
    if (status && !allowed.includes(status)) {
      res.status(400).json({ error: 'Érvénytelen státusz' });
      return;
    }

    await query(
      'UPDATE users SET status = COALESCE(?, status), custom_status = COALESCE(?, custom_status) WHERE id = ?',
      [status || null, custom_status !== undefined ? custom_status : null, req.user!.id]
    );

    const updated = await query<User[]>('SELECT * FROM users WHERE id = ?', [req.user!.id]);
    res.json({ user: formatUser(updated[0]) });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Hiba a státusz frissítésekor' });
  }
};

router.patch('/me/status', authenticateToken, handleUpdateStatus);
router.put('/me/status', authenticateToken, handleUpdateStatus);
router.put('/status', authenticateToken, handleUpdateStatus);

// Upload avatar (PATCH /me/avatar & POST /me/avatar & POST /avatar)
const handleAvatarUpload = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.file && !req.body.avatar_url) {
      res.status(400).json({ error: 'Nincs kép feltöltve vagy avatar_url megadva!' });
      return;
    }

    const avatarUrl = req.file ? `/uploads/${req.file.filename}` : req.body.avatar_url;
    await query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.user!.id]);

    const updated = await query<User[]>('SELECT * FROM users WHERE id = ?', [req.user!.id]);
    res.json({
      message: 'Avatar sikeresen feltöltve!',
      avatar_url: avatarUrl,
      user: formatUser(updated[0])
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Hiba a kép feltöltése során' });
  }
};

router.patch('/me/avatar', authenticateToken, uploadMiddleware.single('avatar'), handleAvatarUpload);
router.post('/me/avatar', authenticateToken, uploadMiddleware.single('avatar'), handleAvatarUpload);
router.post('/avatar', authenticateToken, uploadMiddleware.single('avatar'), handleAvatarUpload);

// Block user
router.post('/:id/block', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id: targetId } = req.params;
    const userId = req.user!.id;

    if (userId === targetId) {
      res.status(400).json({ error: 'Nem tilthatod le saját magadat!' });
      return;
    }

    await query('INSERT IGNORE INTO blocked_users (id, user_id, blocked_user_id) VALUES (UUID(), ?, ?)', [userId, targetId]);
    res.json({ message: 'Felhasználó letiltva' });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Hiba a tiltás során' });
  }
});

// Unblock user
router.delete('/:id/block', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id: targetId } = req.params;
    const userId = req.user!.id;

    await query('DELETE FROM blocked_users WHERE user_id = ? AND blocked_user_id = ?', [userId, targetId]);
    res.json({ message: 'Felhasználó feloldva' });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ error: 'Hiba a feloldás során' });
  }
});

// Get user profile by ID
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const users = await query<User[]>('SELECT * FROM users WHERE id = ?', [id]);
    if (!users || users.length === 0) {
      res.status(404).json({ error: 'Felhasználó nem található' });
      return;
    }

    // Also get mutual servers
    const mutualServers = await query<any[]>(
      `SELECT s.id, s.name, s.icon_url
       FROM servers s
       JOIN server_members sm1 ON sm1.server_id = s.id AND sm1.user_id = ?
       JOIN server_members sm2 ON sm2.server_id = s.id AND sm2.user_id = ?`,
      [req.user!.id, id]
    );

    res.json({
      user: formatUser(users[0]),
      mutualServers
    });
  } catch (error) {
    console.error('Fetch user error:', error);
    res.status(500).json({ error: 'Hiba a profil betöltésekor' });
  }
});

// Search users
router.get('/search/all', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) {
      res.json([]);
      return;
    }

    const users = await query<User[]>(
      `SELECT id, username, display_name, avatar_url, banner_color, bio, custom_status, status, badges, created_at
       FROM users
       WHERE (username LIKE ? OR display_name LIKE ?) AND id != ?
       LIMIT 20`,
      [`%${q}%`, `%${q}%`, req.user!.id]
    );

    res.json(users.map(formatUser));
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Hiba a keresés során' });
  }
});

export default router;
