import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  errorCode?: string;
  message?: string;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

export function createRateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    errorCode = 'RATE_LIMIT_EXCEEDED',
    message = 'Túl sok kérés érkezett erről a hálózatról. Kérjük próbáld újra később.'
  } = options;

  const hits = new Map<string, ClientRecord>();

  // Periodically clean up expired records
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, 60000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
               req.socket.remoteAddress ||
               'unknown';

    const key = `${req.baseUrl || req.path}:${ip}`;
    const now = Date.now();
    const record = hits.get(key);

    if (!record || now > record.resetTime) {
      hits.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    record.count++;
    if (record.count > maxRequests) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec.toString());
      sendError(res, errorCode, message, 429);
      return;
    }

    next();
  };
}

// Preconfigured rate limiters
export const authLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 500,
  errorCode: 'AUTH_RATE_LIMIT',
  message: 'Túl sok kérés érkezett erről a hálózatról. Kérjük próbáld újra egy perc múlva.'
});

export const messageLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 500,
  errorCode: 'MESSAGE_RATE_LIMIT',
  message: 'Túl gyorsan küldesz üzeneteket.'
});

export const uploadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 100,
  errorCode: 'UPLOAD_RATE_LIMIT',
  message: 'Túl sok fájlfeltöltés percenként.'
});
