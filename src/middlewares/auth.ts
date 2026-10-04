import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config/index.js';
import { query } from '../database/db.js';
import { User } from '../types/index.js';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : (req.query.token as string | undefined);

  if (!token) {
    res.status(401).json({ error: 'Nincs bejelentkezve (token hiányzik)' });
    return;
  }

  try {
    const payload = jwt.verify(token, CONFIG.JWT.secret) as { id: string };
    const users = await query<User[]>('SELECT * FROM users WHERE id = ?', [payload.id]);

    if (!users || users.length === 0) {
      res.status(401).json({ error: 'Felhasználó nem található' });
      return;
    }

    req.user = users[0];
    next();
  } catch (err) {
    res.status(403).json({ error: 'Érvénytelen vagy lejárt token' });
  }
}
