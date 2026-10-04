import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config/index.js';
import { query } from '../database/db.js';
import { VoiceParticipant } from '../types/index.js';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
}

// User ID -> Set of socket IDs
const userSockets = new Map<string, Set<string>>();

// Channel ID -> Map<userId, VoiceParticipant>
const voiceChannels = new Map<string, Map<string, VoiceParticipant>>();

// Socket ID -> Current voice channel ID
const socketVoiceMap = new Map<string, string>();

export function setupSocketIO(io: SocketIOServer): void {
  // Middleware for auth
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token as string, CONFIG.JWT.secret) as { id: string };
      const users = await query<any[]>('SELECT * FROM users WHERE id = ?', [decoded.id]);

      if (!users || users.length === 0) {
        return next(new Error('User not found'));
      }

      socket.userId = decoded.id;
      socket.user = users[0];
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    const user = socket.user!;

    // Track socket
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket.id);

    // Join personal room for DMs and direct notifications
    socket.join(`user:${userId}`);

    // Join rooms for all servers user is member of
    const userServers = await query<any[]>('SELECT server_id FROM server_members WHERE user_id = ?', [userId]);
    for (const s of userServers) {
      socket.join(`server:${s.server_id}`);
    }

    // Broadcast presence update
    io.emit('presence:update', {
      userId,
      status: user.status === 'invisible' ? 'offline' : user.status,
      custom_status: user.custom_status
    });

    console.log(`[Socket] User ${user.username} (${userId}) connected [socket: ${socket.id}]`);

    // Channel subscription
    socket.on('channel:join', (channelId: string) => {
      socket.join(`channel:${channelId}`);
    });

    socket.on('channel:leave', (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    // Chat Typing
    socket.on('typing:start', ({ channelId, recipientId }: { channelId?: string; recipientId?: string }) => {
      const payload = {
        userId,
        username: user.username,
        displayName: user.display_name,
        channelId,
        recipientId
      };
      if (channelId) {
        socket.to(`channel:${channelId}`).emit('typing:start', payload);
      } else if (recipientId) {
        socket.to(`user:${recipientId}`).emit('typing:start', payload);
      }
    });

    socket.on('typing:stop', ({ channelId, recipientId }: { channelId?: string; recipientId?: string }) => {
      const payload = { userId, channelId, recipientId };
      if (channelId) {
        socket.to(`channel:${channelId}`).emit('typing:stop', payload);
      } else if (recipientId) {
        socket.to(`user:${recipientId}`).emit('typing:stop', payload);
      }
    });

    // Messages
    socket.on('message:send', (messageData: any) => {
      if (messageData.channel_id) {
        io.to(`channel:${messageData.channel_id}`).emit('message:new', messageData);
      } else if (messageData.dm_recipient_id) {
        io.to(`user:${messageData.dm_recipient_id}`).to(`user:${userId}`).emit('message:new', messageData);
      }
    });

    socket.on('message:update', (messageData: any) => {
      if (messageData.channel_id) {
        io.to(`channel:${messageData.channel_id}`).emit('message:update', messageData);
      } else if (messageData.dm_recipient_id) {
        io.to(`user:${messageData.dm_recipient_id}`).to(`user:${userId}`).emit('message:update', messageData);
      }
    });

    socket.on('message:delete', ({ messageId, channelId, recipientId }: any) => {
      if (channelId) {
        io.to(`channel:${channelId}`).emit('message:delete', { messageId, channelId });
      } else if (recipientId) {
        io.to(`user:${recipientId}`).to(`user:${userId}`).emit('message:delete', { messageId, recipientId });
      }
    });

    // Message reactions
    socket.on('reaction:update', ({ messageId, channelId, recipientId, reactions }: any) => {
      if (channelId) {
        io.to(`channel:${channelId}`).emit('reaction:update', { messageId, reactions });
      } else if (recipientId) {
        io.to(`user:${recipientId}`).to(`user:${userId}`).emit('reaction:update', { messageId, reactions });
      }
    });

    // Server events
    socket.on('server:join_room', (serverId: string) => {
      socket.join(`server:${serverId}`);
    });

    // --- Voice & WebRTC Signaling ---
    socket.on('voice:join', async (data: {
      channelId: string;
      isMuted?: boolean;
      isDeafened?: boolean;
      isScreenSharing?: boolean;
      screenShareQuality?: string;
      isVideo?: boolean;
    }) => {
      const { channelId } = data;

      // Leave any existing voice channel first
      const prevChan = socketVoiceMap.get(socket.id);
      if (prevChan && prevChan !== channelId) {
        leaveVoiceChannel(socket, prevChan, io);
      }

      socketVoiceMap.set(socket.id, channelId);
      socket.join(`voice:${channelId}`);

      if (!voiceChannels.has(channelId)) {
        voiceChannels.set(channelId, new Map());
      }

      const participant: VoiceParticipant = {
        userId,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        isMuted: !!data.isMuted,
        isDeafened: !!data.isDeafened,
        isScreenSharing: !!data.isScreenSharing,
        screenShareQuality: data.screenShareQuality || '720p30',
        isVideo: !!data.isVideo,
        isSpeaking: false
      };

      voiceChannels.get(channelId)!.set(userId, participant);

      // Record in database if it is a server channel
      try {
        await query(
          `INSERT INTO voice_sessions (id, channel_id, user_id, is_muted, is_deafened, is_screensharing, is_video, joined_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id), is_muted = VALUES(is_muted), is_deafened = VALUES(is_deafened), is_screensharing = VALUES(is_screensharing), is_video = VALUES(is_video)`,
          [channelId, userId, participant.isMuted, participant.isDeafened, participant.isScreenSharing, participant.isVideo]
        );
      } catch (err) {
        // DM voice call or virtual channel without foreign key reference
      }

      // Send existing participants in this channel to the joining user
      const currentParticipants = Array.from(voiceChannels.get(channelId)!.values());
      socket.emit('voice:user-list', { channelId, participants: currentParticipants });

      // Notify others in channel
      socket.to(`voice:${channelId}`).emit('voice:user-joined', { channelId, participant });

      // Notify server members for channel participant badge
      try {
        const chan = await query<any[]>('SELECT server_id FROM channels WHERE id = ?', [channelId]);
        if (chan && chan.length > 0) {
          io.to(`server:${chan[0].server_id}`).emit('voice:channel-update', {
            channelId,
            participants: currentParticipants
          });
        }
      } catch (e) {
        // Ignore for DM calls
      }
    });

    socket.on('voice:leave', async () => {
      const channelId = socketVoiceMap.get(socket.id);
      if (channelId) {
        await leaveVoiceChannel(socket, channelId, io);
        socketVoiceMap.delete(socket.id);
      }
    });

    // DM Call Signaling
    socket.on('dm:call-start', (data: { recipientId: string; callerName: string; callerAvatar?: string; channelId: string; isVideo?: boolean }) => {
      const { recipientId, callerName, callerAvatar, channelId, isVideo } = data;
      io.to(`user:${recipientId}`).emit('dm:incoming-call', {
        callerId: userId,
        callerName: callerName || user.display_name,
        callerAvatar: callerAvatar || user.avatar_url,
        channelId,
        isVideo: !!isVideo
      });
    });

    socket.on('dm:call-accept', (data: { callerId: string; channelId: string }) => {
      io.to(`user:${data.callerId}`).emit('dm:call-accepted', {
        responderId: userId,
        channelId: data.channelId
      });
    });

    socket.on('dm:call-reject', (data: { callerId: string }) => {
      io.to(`user:${data.callerId}`).emit('dm:call-rejected', {
        responderId: userId
      });
    });

    socket.on('dm:call-end', (data: { recipientId: string; channelId: string }) => {
      io.to(`user:${data.recipientId}`).emit('dm:call-ended', {
        fromUserId: userId,
        channelId: data.channelId
      });
    });

    // WebRTC Signaling Relay
    socket.on('voice:signal', (data: { toUserId: string; signal: any; streamType: 'voice' | 'screen' | 'video' }) => {
      const { toUserId, signal, streamType } = data;
      io.to(`user:${toUserId}`).emit('voice:signal', {
        fromUserId: userId,
        signal,
        streamType
      });
    });

    // State update (mute, deafen, screenshare, video, speaking)
    socket.on('voice:state', async (data: Partial<VoiceParticipant> & { channelId: string }) => {
      const { channelId } = data;
      const chanParticipants = voiceChannels.get(channelId);
      if (chanParticipants && chanParticipants.has(userId)) {
        const current = chanParticipants.get(userId)!;
        Object.assign(current, data);

        // Broadcast to voice room
        io.to(`voice:${channelId}`).emit('voice:state-updated', {
          channelId,
          userId,
          updates: data
        });

        // Update DB
        if (data.isMuted !== undefined || data.isDeafened !== undefined || data.isScreenSharing !== undefined || data.isVideo !== undefined) {
          await query(
            'UPDATE voice_sessions SET is_muted = COALESCE(?, is_muted), is_deafened = COALESCE(?, is_deafened), is_screensharing = COALESCE(?, is_screensharing), is_video = COALESCE(?, is_video) WHERE user_id = ?',
            [data.isMuted ?? null, data.isDeafened ?? null, data.isScreenSharing ?? null, data.isVideo ?? null, userId]
          );
        }
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      const currentVoiceChannel = socketVoiceMap.get(socket.id);
      if (currentVoiceChannel) {
        await leaveVoiceChannel(socket, currentVoiceChannel, io);
        socketVoiceMap.delete(socket.id);
      }

      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);

          // Update user status in DB to offline if they weren't invisible
          if (user.status !== 'invisible') {
            await query("UPDATE users SET status = 'offline' WHERE id = ?", [userId]);
          }

          io.emit('presence:update', {
            userId,
            status: 'offline'
          });
        }
      }

      console.log(`[Socket] User ${user.username} disconnected [socket: ${socket.id}]`);
    });
  });
}

async function leaveVoiceChannel(socket: AuthenticatedSocket, channelId: string, io: SocketIOServer): Promise<void> {
  const userId = socket.userId!;
  socket.leave(`voice:${channelId}`);

  const chanParticipants = voiceChannels.get(channelId);
  if (chanParticipants) {
    chanParticipants.delete(userId);
    if (chanParticipants.size === 0) {
      voiceChannels.delete(channelId);
    }
  }

  // Remove session from DB
  await query('DELETE FROM voice_sessions WHERE user_id = ?', [userId]);

  // Notify channel
  io.to(`voice:${channelId}`).emit('voice:user-left', { channelId, userId });

  // Update server channels
  const chan = await query<any[]>('SELECT server_id FROM channels WHERE id = ?', [channelId]);
  if (chan && chan.length > 0) {
    const remaining = chanParticipants ? Array.from(chanParticipants.values()) : [];
    io.to(`server:${chan[0].server_id}`).emit('voice:channel-update', {
      channelId,
      participants: remaining
    });
  }
}
