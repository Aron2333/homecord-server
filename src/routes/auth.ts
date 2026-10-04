import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/db.js';
import { CONFIG } from '../config/index.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimiter.js';
import { sendSuccess, sendError } from '../utils/response.js';
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

function generateTokens(userId: string) {
  const accessToken = jwt.sign({ id: userId }, CONFIG.JWT.secret, { expiresIn: '1d' });
  const refreshToken = jwt.sign({ id: userId, type: 'refresh' }, CONFIG.JWT.secret, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res): Promise<void> => {
  try {
    const { username, display_name, email, password, avatar_url } = req.body;

    if (!username || !email || !password) {
      sendError(res, 'MISSING_FIELDS', 'Minden kötelező mezőt ki kell tölteni (felhasználónév, email, jelszó)!', 400);
      return;
    }

    if (username.length < 3 || username.length > 32) {
      sendError(res, 'INVALID_USERNAME_LENGTH', 'A felhasználónév 3 és 32 karakter közötti lehet!', 400);
      return;
    }

    if (password.length < 6) {
      sendError(res, 'PASSWORD_TOO_SHORT', 'A jelszónak legalább 6 karakterből kell állnia!', 400);
      return;
    }

    // Check if user exists
    const existing = await query<User[]>(
      'SELECT id, username, email FROM users WHERE username = ? OR email = ?',
      [username.trim(), email.trim()]
    );

    if (existing && existing.length > 0) {
      if (existing[0].username.toLowerCase() === username.trim().toLowerCase()) {
        sendError(res, 'USERNAME_TAKEN', 'Ez a felhasználónév már foglalt!', 400);
        return;
      }
      sendError(res, 'EMAIL_TAKEN', 'Ez az e-mail cím már regisztrálva van!', 400);
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const userId = uuidv4();
    const finalDisplayName = (display_name && display_name.trim().length > 0) ? display_name.trim() : username.trim();

    await query(
      `INSERT INTO users (id, username, display_name, email, password_hash, avatar_url, banner_color, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'online', NOW())`,
      [
        userId,
        username.trim(),
        finalDisplayName,
        email.trim().toLowerCase(),
        passwordHash,
        avatar_url || null,
        '#5865F2'
      ]
    );

    // Create user profile (optional/best-effort)
    try {
      await query(
        `INSERT INTO user_profiles (user_id, bio, theme, created_at) VALUES (?, ?, 'dark', NOW())
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        [userId, '']
      );
    } catch (e: any) {
      console.warn('[AUTH] Profile insertion skipped:', e?.message);
    }

    // Assign Early User badge (optional/best-effort)
    try {
      await query(
        `INSERT IGNORE INTO user_badges (id, user_id, badge_id, awarded_at)
         VALUES (UUID(), ?, 'b1000000-0000-0000-0000-000000000001', NOW())`,
        [userId]
      );
    } catch (e: any) {
      console.warn('[AUTH] Badge insertion skipped:', e?.message);
    }

    const { accessToken, refreshToken } = generateTokens(userId);

    // Save session (best-effort)
    try {
      await query(
        `INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), NOW())`,
        [
          uuidv4(),
          userId,
          refreshToken,
          req.headers['user-agent'] || null,
          (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null
        ]
      );
    } catch (e: any) {
      console.warn('[AUTH] Session record insertion skipped:', e?.message);
    }

    const newUser = await query<User[]>('SELECT * FROM users WHERE id = ?', [userId]);

    // Backwards compatible response supporting both data/token and envelope
    res.status(201).json({
      success: true,
      data: {
        token: accessToken,
        accessToken,
        refreshToken,
        user: formatUser(newUser[0])
      },
      token: accessToken,
      user: formatUser(newUser[0])
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    sendError(res, 'INTERNAL_ERROR', 'Hiba történt a regisztráció során.', 500);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res): Promise<void> => {
  try {
    const { login, password, remember_me, rememberMe } = req.body;
    const isRemember = remember_me ?? rememberMe ?? true;

    if (!login || !password) {
      sendError(res, 'MISSING_CREDENTIALS', 'Kérjük adja meg a felhasználónevet/emailt és a jelszót!', 400);
      return;
    }

    const users = await query<User[]>(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [login.trim(), login.trim().toLowerCase()]
    );

    if (!users || users.length === 0) {
      sendError(res, 'INVALID_CREDENTIALS', 'Hibás bejelentkezési adatok!', 401);
      return;
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password_hash!);

    if (!isMatch) {
      sendError(res, 'INVALID_CREDENTIALS', 'Hibás bejelentkezési adatok!', 401);
      return;
    }

    const { accessToken, refreshToken } = generateTokens(user.id);

    // Save session (best-effort)
    try {
      await query(
        `INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), NOW())`,
        [
          uuidv4(),
          user.id,
          refreshToken,
          req.headers['user-agent'] || null,
          (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null
        ]
      );
    } catch (e: any) {
      console.warn('[AUTH] Login session record insertion skipped:', e?.message);
    }

    // Update status to online if offline
    await query("UPDATE users SET status = 'online' WHERE id = ? AND status = 'offline'", [user.id]);

    res.json({
      success: true,
      data: {
        token: accessToken,
        accessToken,
        refreshToken,
        user: formatUser(user)
      },
      token: accessToken,
      user: formatUser(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    sendError(res, 'INTERNAL_ERROR', 'Hiba történt a bejelentkezés során.', 500);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      sendError(res, 'MISSING_REFRESH_TOKEN', 'Hiányzó refresh token!', 400);
      return;
    }

    // Verify refresh token in DB
    const sessionRows = await query<any[]>(
      'SELECT * FROM sessions WHERE refresh_token = ? AND expires_at > NOW()',
      [refreshToken]
    );

    if (!sessionRows || sessionRows.length === 0) {
      sendError(res, 'INVALID_SESSION', 'A munkamenet lejárt vagy érvénytelen.', 401);
      return;
    }

    const userId = sessionRows[0].user_id;
    const tokens = generateTokens(userId);

    // Rotate refresh token
    await query('UPDATE sessions SET refresh_token = ? WHERE id = ?', [tokens.refreshToken, sessionRows[0].id]);

    sendSuccess(res, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      token: tokens.accessToken
    });
  } catch (err: any) {
    sendError(res, 'REFRESH_FAILED', 'Nem sikerült megújítani a tokent.', 401);
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('DELETE FROM sessions WHERE refresh_token = ?', [refreshToken]);
    } else if (req.user) {
      await query('DELETE FROM sessions WHERE user_id = ?', [req.user.id]);
    }
    sendSuccess(res, { message: 'Sikeres kijelentkezés.' });
  } catch (err: any) {
    sendError(res, 'LOGOUT_ERROR', 'Hiba a kijelentkezéskor.', 500);
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const formatted = formatUser(req.user);
  res.json({
    success: true,
    data: { user: formatted },
    user: formatted
  });
});

// POST /api/auth/password
router.post('/password', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password || new_password.length < 6) {
      sendError(res, 'INVALID_PASSWORD', 'Az új jelszónak legalább 6 karakter hosszúnak kell lennie!', 400);
      return;
    }

    const isMatch = await bcrypt.compare(current_password, req.user!.password_hash!);
    if (!isMatch) {
      sendError(res, 'WRONG_PASSWORD', 'A jelenlegi jelszó helytelen!', 400);
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(new_password, salt);

    await query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user!.id]);
    sendSuccess(res, { message: 'Jelszó sikeresen megváltoztatva!' });
  } catch (error) {
    console.error('Password change error:', error);
    sendError(res, 'PASSWORD_CHANGE_FAILED', 'Hiba történt a jelszó módosítása közben.', 500);
  }
});

// POST /api/auth/delete-account
router.post('/delete-account', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { password } = req.body;
    if (!password) {
      sendError(res, 'PASSWORD_REQUIRED', 'A fiók törléséhez szükséges megadni a jelszót!', 400);
      return;
    }

    const isMatch = await bcrypt.compare(password, req.user!.password_hash!);
    if (!isMatch) {
      sendError(res, 'WRONG_PASSWORD', 'A megadott jelszó helytelen!', 400);
      return;
    }

    await query('DELETE FROM users WHERE id = ?', [req.user!.id]);
    sendSuccess(res, { message: 'Fiók sikeresen törölve.' });
  } catch (error) {
    console.error('Account deletion error:', error);
    sendError(res, 'ACCOUNT_DELETION_FAILED', 'Hiba történt a fiók törlése során.', 500);
  }
});

export default router;
