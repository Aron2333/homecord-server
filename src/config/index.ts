import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  API_URL: process.env.API_URL || 'http://localhost:4000',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',

  DB: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'otpcord',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ssl: (process.env.DB_SSL === 'true' || (process.env.DB_HOST && (process.env.DB_HOST.includes('tidbcloud.com') || process.env.DB_HOST.includes('aivencloud.com')))) ? {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: false
    } : undefined
  },

  JWT: {
    secret: process.env.JWT_SECRET || 'otpcord_super_secret_jwt_key_9823478912347109238471029348',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },

  UPLOAD: {
    dir: process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads'),
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10)
  },

  WEBRTC: {
    stunServers: (process.env.STUN_SERVERS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
      .split(',')
      .map(s => s.trim())
  }
};
