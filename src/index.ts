import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { CONFIG } from './config/index.js';
import { initDatabase, checkDatabaseHealth } from './database/db.js';
import { setupSocketIO } from './websocket/socketHandler.js';

import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import friendsRouter from './routes/friends.js';
import serversRouter from './routes/servers.js';
import rolesRouter from './routes/roles.js';
import tagsRouter from './routes/tags.js';
import channelsRouter from './routes/channels.js';
import messagesRouter from './routes/messages.js';
import invitesRouter from './routes/invites.js';
import emojisRouter from './routes/emojis.js';
import stickersRouter from './routes/stickers.js';
import uploadsRouter from './routes/uploads.js';
import notificationsRouter from './routes/notifications.js';
import searchRouter from './routes/search.js';

const app = express();
const server = http.createServer(app);

// Setup Socket.IO
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  },
  maxHttpBufferSize: 1e8 // 100 MB buffer
});

app.set('trust proxy', true);

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder', 'ngrok-skip-browser-warning', 'X-Requested-With']
}));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static uploads serving
app.use('/uploads', express.static(CONFIG.UPLOAD.dir));

// Root info & health check
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    name: 'OTPCord Backend Server',
    version: '1.0.0',
    time: new Date()
  });
});

// Health check endpoints (Specification #29)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', name: 'OTPCord Backend' });
});

app.get('/health/database', async (_req, res) => {
  const isHealthy = await checkDatabaseHealth();
  if (isHealthy) {
    res.json({ status: 'ok' });
  } else {
    res.status(503).json({ status: 'error', message: 'Database unreachable' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'OTPCord Backend', time: new Date() });
});

app.get('/api/health/database', async (_req, res) => {
  const isHealthy = await checkDatabaseHealth();
  if (isHealthy) {
    res.json({ status: 'ok' });
  } else {
    res.status(503).json({ status: 'error', message: 'Database unreachable' });
  }
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/servers', serversRouter);
app.use('/api/servers', rolesRouter);
app.use('/api/servers', tagsRouter);
app.use('/api/servers', channelsRouter);
app.use('/api/servers', emojisRouter);
app.use('/api/servers', stickersRouter);
app.use('/api/servers', invitesRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/dms', messagesRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/emojis', emojisRouter);
app.use('/api/stickers', stickersRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/search', searchRouter);
app.use('/api', messagesRouter);

// Global Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: err.message || 'Belső szerverhiba történt'
    }
  });
});

async function startServer() {
  try {
    console.log('[OTPCord] API starting...');
    await initDatabase();
    console.log('[OTPCord] Database connected');
    setupSocketIO(io);
    console.log('[OTPCord] WebSocket ready');

    server.listen(CONFIG.PORT, CONFIG.HOST, () => {
      console.log(`[OTPCord] API started`);
      console.log(`[OTPCord] Server listening on http://${CONFIG.HOST}:${CONFIG.PORT}`);
    });
  } catch (error) {
    console.error('[FATAL] Failed to start OTPCord server:', error);
    process.exit(1);
  }
}

startServer();

export { app, server, io };
