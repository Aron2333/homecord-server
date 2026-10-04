import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../config/index.js';

// Ensure upload directory exists
if (!fs.existsSync(CONFIG.UPLOAD.dir)) {
  fs.mkdirSync(CONFIG.UPLOAD.dir, { recursive: true });
}

// Banned executable extensions for security
const BANNED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.vbs', '.scr', '.msi',
  '.pif', '.application', '.gadget', '.hta', '.cpl', '.msc', '.jar', '.com'
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, CONFIG.UPLOAD.dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  }
});

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: CONFIG.UPLOAD.maxFileSizeMb * 1024 * 1024 // 50MB
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BANNED_EXTENSIONS.has(ext)) {
      return cb(new Error(`A megadott fájltípus (${ext}) biztonsági okokból nem engedélyezett!`));
    }
    cb(null, true);
  }
});
