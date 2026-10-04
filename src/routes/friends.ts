import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { UserPublic } from '../types/index.js';

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

// Get all friends and friend requests
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Friends list
    const friends = await query<any[]>(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.banner_color, u.bio, u.custom_status, u.status, u.badges, u.created_at
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ?`,
      [userId]
    );

    // Incoming requests
    const incoming = await query<any[]>(
      `SELECT fr.id as request_id, fr.created_at as request_time,
              u.id, u.username, u.display_name, u.avatar_url, u.banner_color, u.bio, u.custom_status, u.status, u.badges, u.created_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.sender_id
       WHERE fr.receiver_id = ? AND fr.status = 'pending'`,
      [userId]
    );

    // Outgoing requests
    const outgoing = await query<any[]>(
      `SELECT fr.id as request_id, fr.created_at as request_time,
              u.id, u.username, u.display_name, u.avatar_url, u.banner_color, u.bio, u.custom_status, u.status, u.badges, u.created_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.receiver_id
       WHERE fr.sender_id = ? AND fr.status = 'pending'`,
      [userId]
    );

    // Blocked users
    const blocked = await query<any[]>(
      `SELECT b.id as block_id,
              u.id, u.username, u.display_name, u.avatar_url, u.banner_color, u.bio, u.custom_status, u.status, u.badges, u.created_at
       FROM blocked_users b
       JOIN users u ON u.id = b.blocked_user_id
       WHERE b.user_id = ?`,
      [userId]
    );

    res.json({
      friends: friends.map(formatUser),
      incoming: incoming.map(r => ({
        requestId: r.request_id,
        requestTime: r.request_time,
        user: formatUser(r)
      })),
      outgoing: outgoing.map(r => ({
        requestId: r.request_id,
        requestTime: r.request_time,
        user: formatUser(r)
      })),
      blocked: blocked.map(b => ({
        blockId: b.block_id,
        user: formatUser(b)
      }))
    });
  } catch (error) {
    console.error('Fetch friends error:', error);
    res.status(500).json({ error: 'Hiba a barátok lekérésekor' });
  }
});

// Get friend requests specifically
router.get('/requests', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const incoming = await query<any[]>(
      `SELECT fr.id as request_id, fr.created_at as request_time,
              u.id, u.username, u.display_name, u.avatar_url, u.banner_color, u.bio, u.custom_status, u.status, u.badges, u.created_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.sender_id
       WHERE fr.receiver_id = ? AND fr.status = 'pending'`,
      [userId]
    );

    const outgoing = await query<any[]>(
      `SELECT fr.id as request_id, fr.created_at as request_time,
              u.id, u.username, u.display_name, u.avatar_url, u.banner_color, u.bio, u.custom_status, u.status, u.badges, u.created_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.receiver_id
       WHERE fr.sender_id = ? AND fr.status = 'pending'`,
      [userId]
    );

    res.json({
      incoming: incoming.map(r => ({
        requestId: r.request_id,
        requestTime: r.request_time,
        user: formatUser(r)
      })),
      outgoing: outgoing.map(r => ({
        requestId: r.request_id,
        requestTime: r.request_time,
        user: formatUser(r)
      }))
    });
  } catch (error) {
    console.error('Fetch friend requests error:', error);
    res.status(500).json({ error: 'Hiba a barátkérések lekérésekor' });
  }
});

// Send friend request by username
router.post('/request', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { username } = req.body;
    const userId = req.user!.id;

    if (!username || !username.trim()) {
      res.status(400).json({ error: 'Kérjük adja meg a felhasználónevet!' });
      return;
    }

    const cleanUsername = username.trim().toLowerCase();

    // Cannot add self
    if (cleanUsername === req.user!.username.toLowerCase()) {
      res.status(400).json({ error: 'Nem adhatod hozzá saját magadat barátként!' });
      return;
    }

    const targetUsers = await query<any[]>(
      'SELECT id, username, display_name FROM users WHERE LOWER(username) = ?',
      [cleanUsername]
    );

    if (!targetUsers || targetUsers.length === 0) {
      res.status(404).json({ error: 'Nem található felhasználó ezzel a névvel!' });
      return;
    }

    const targetId = targetUsers[0].id;

    // Check if blocked
    const isBlocked = await query<any[]>(
      'SELECT id FROM blocked_users WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)',
      [userId, targetId, targetId, userId]
    );
    if (isBlocked && isBlocked.length > 0) {
      res.status(400).json({ error: 'A kérést nem lehet elküldeni blokkolás miatt!' });
      return;
    }

    // Check if already friends
    const isFriend = await query<any[]>(
      'SELECT id FROM friendships WHERE user_id = ? AND friend_id = ?',
      [userId, targetId]
    );
    if (isFriend && isFriend.length > 0) {
      res.status(400).json({ error: 'Már barátok vagytok ezzel a felhasználóval!' });
      return;
    }

    // Check existing request
    const existingReq = await query<any[]>(
      'SELECT id, sender_id, status FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)',
      [userId, targetId, targetId, userId]
    );

    if (existingReq && existingReq.length > 0) {
      const r = existingReq[0];
      if (r.sender_id === userId && r.status === 'pending') {
        res.status(400).json({ error: 'Már küldtél barátkérelmet ennek a felhasználónak!' });
        return;
      }
      if (r.sender_id === targetId && r.status === 'pending') {
        // The other person already sent a request, auto-accept it!
        await withTransaction(async (conn) => {
          await conn.query('DELETE FROM friend_requests WHERE id = ?', [r.id]);
          await conn.query('INSERT IGNORE INTO friendships (id, user_id, friend_id) VALUES (?, ?, ?), (?, ?, ?)', [
            uuidv4(), userId, targetId,
            uuidv4(), targetId, userId
          ]);
        });
        res.json({ message: 'Barátkérés automatikusan elfogadva, mert már kaptál tőle felkérést!' });
        return;
      }
    }

    // Insert new request
    const requestId = uuidv4();
    await query(
      'INSERT INTO friend_requests (id, sender_id, receiver_id, status, created_at) VALUES (?, ?, ?, "pending", NOW())',
      [requestId, userId, targetId]
    );

    res.json({ message: `Barátkérés sikeresen elküldve neki: ${targetUsers[0].display_name}!` });
  } catch (error) {
    console.error('Send friend request error:', error);
    res.status(500).json({ error: 'Hiba a barátkérés küldése közben' });
  }
});

// Accept request (supports /accept/:requestId and /:id/accept)
const handleAcceptFriendRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const paramId = req.params.requestId || req.params.id;
    const userId = req.user!.id;

    // Search by request ID or sender ID
    const requests = await query<any[]>(
      'SELECT * FROM friend_requests WHERE (id = ? OR sender_id = ?) AND receiver_id = ?',
      [paramId, paramId, userId]
    );

    if (!requests || requests.length === 0) {
      res.status(404).json({ error: 'A barátkérés nem található!' });
      return;
    }

    const request = requests[0];
    const friendId = request.sender_id;

    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM friend_requests WHERE id = ?', [request.id]);
      await conn.query(
        'INSERT IGNORE INTO friendships (id, user_id, friend_id) VALUES (?, ?, ?), (?, ?, ?)',
        [uuidv4(), userId, friendId, uuidv4(), friendId, userId]
      );
    });

    res.json({ message: 'Barátkérés sikeresen elfogadva!' });
  } catch (error) {
    console.error('Accept friend request error:', error);
    res.status(500).json({ error: 'Hiba a kérés elfogadásakor' });
  }
};

router.post('/accept/:requestId', authenticateToken, handleAcceptFriendRequest);
router.post('/:id/accept', authenticateToken, handleAcceptFriendRequest);

// Decline request (supports /decline/:requestId and /:id/decline)
const handleDeclineFriendRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const paramId = req.params.requestId || req.params.id;
    const userId = req.user!.id;

    await query('DELETE FROM friend_requests WHERE (id = ? OR sender_id = ?) AND receiver_id = ?', [paramId, paramId, userId]);
    res.json({ message: 'Barátkérés elutasítva' });
  } catch (error) {
    console.error('Decline friend request error:', error);
    res.status(500).json({ error: 'Hiba a kérés elutasításakor' });
  }
};

router.post('/decline/:requestId', authenticateToken, handleDeclineFriendRequest);
router.post('/:id/decline', authenticateToken, handleDeclineFriendRequest);

// Cancel outgoing request
router.post('/cancel/:requestId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const userId = req.user!.id;

    await query('DELETE FROM friend_requests WHERE id = ? AND sender_id = ?', [requestId, userId]);
    res.json({ message: 'Barátkérés visszavonva' });
  } catch (error) {
    console.error('Cancel friend request error:', error);
    res.status(500).json({ error: 'Hiba a kérés visszavonásakor' });
  }
});

// Remove friend
router.delete('/:friendId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { friendId } = req.params;
    const userId = req.user!.id;

    await query(
      'DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [userId, friendId, friendId, userId]
    );

    res.json({ message: 'Barát sikeresen eltávolítva' });
  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(500).json({ error: 'Hiba a barát eltávolításakor' });
  }
});

// Block user
router.post('/block/:targetId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { targetId } = req.params;
    const userId = req.user!.id;

    await withTransaction(async (conn) => {
      // Remove any friendships
      await conn.query(
        'DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
        [userId, targetId, targetId, userId]
      );
      // Remove pending requests
      await conn.query(
        'DELETE FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)',
        [userId, targetId, targetId, userId]
      );
      // Insert block
      await conn.query(
        'INSERT IGNORE INTO blocked_users (id, user_id, blocked_user_id) VALUES (?, ?, ?)',
        [uuidv4(), userId, targetId]
      );
    });

    res.json({ message: 'Felhasználó tiltva' });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Hiba a tiltás során' });
  }
});

// Unblock user
router.delete('/unblock/:targetId', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { targetId } = req.params;
    const userId = req.user!.id;

    await query('DELETE FROM blocked_users WHERE user_id = ? AND blocked_user_id = ?', [userId, targetId]);
    res.json({ message: 'Felhasználó tiltása feloldva' });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ error: 'Hiba a feloldás során' });
  }
});

export default router;
