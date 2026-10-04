import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { uploadMiddleware } from '../middlewares/upload.js';
import { uploadLimiter } from '../middlewares/rateLimiter.js';
import { sendSuccess, sendError } from '../utils/response.js';

const router = Router();

// POST /api/uploads - Upload single file
router.post(
  '/',
  authenticateToken,
  uploadLimiter,
  uploadMiddleware.single('file'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        sendError(res, 'NO_FILE', 'Nem választottál ki fájlt feltöltésre!', 400);
        return;
      }

      const fileUrl = `/uploads/${req.file.filename}`;
      sendSuccess(res, {
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      }, 201);
    } catch (err: any) {
      console.error('File upload error:', err);
      sendError(res, 'UPLOAD_FAILED', err.message || 'Hiba történt a fájl feltöltése során.', 500);
    }
  }
);

export default router;
