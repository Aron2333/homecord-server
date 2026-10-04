import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../database/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.js';
import { uploadMiddleware } from '../middlewares/upload.js';
import { hasPermission } from '../services/permissionService.js';
import { Message, Attachment, Role, Tag } from '../types/index.js';

const router = Router();

// Helper to populate sender, reactions, attachments, role and tags
async function populateMessages(messages: any[], serverId?: string | null): Promise<Message[]> {
  if (!messages || messages.length === 0) return [];

  const messageIds = messages.map(m => m.id);
  const userIds = [...new Set(messages.map(m => m.sender_id))];

  // Fetch senders
  const users = await query<any[]>(
    `SELECT id, username, display_name, avatar_url, banner_color, bio, custom_status, status, badges, created_at
     FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`,
    userIds
  );
  const userMap = new Map(users.map(u => [u.id, {
    ...u,
    badges: typeof u.badges === 'string' ? JSON.parse(u.badges) : u.badges || []
  }]));

  // Fetch attachments
  const attachments = await query<Attachment[]>(
    `SELECT * FROM attachments WHERE message_id IN (${messageIds.map(() => '?').join(',')})`,
    messageIds
  );
  const attachmentMap = new Map<string, Attachment[]>();
  for (const a of attachments) {
    if (!attachmentMap.has(a.message_id)) attachmentMap.set(a.message_id, []);
    attachmentMap.get(a.message_id)!.push(a);
  }

  // Fetch reactions
  const reactions = await query<any[]>(
    `SELECT mr.*, u.username
     FROM message_reactions mr
     JOIN users u ON u.id = mr.user_id
     WHERE mr.message_id IN (${messageIds.map(() => '?').join(',')})`,
    messageIds
  );
  const reactionMap = new Map<string, Record<string, { count: number; users: string[]; reacted: boolean }>>();
  for (const r of reactions) {
    if (!reactionMap.has(r.message_id)) reactionMap.set(r.message_id, {});
    const rGroup = reactionMap.get(r.message_id)!;
    if (!rGroup[r.emoji]) {
      rGroup[r.emoji] = { count: 0, users: [], reacted: false };
    }
    rGroup[r.emoji].count++;
    rGroup[r.emoji].users.push(r.username);
  }

  // Fetch server roles and tags if channel is in a server
  const roleMap = new Map<string, Role[]>();
  const tagMap = new Map<string, Tag[]>();
  if (serverId) {
    const roles = await query<any[]>(
      `SELECT mr.user_id, r.* FROM roles r
       JOIN member_roles mr ON mr.role_id = r.id
       WHERE mr.server_id = ? AND mr.user_id IN (${userIds.map(() => '?').join(',')})
       ORDER BY r.position DESC`,
      [serverId, ...userIds]
    );
    for (const r of roles) {
      if (!roleMap.has(r.user_id)) roleMap.set(r.user_id, []);
      roleMap.get(r.user_id)!.push(r);
    }

    const tags = await query<any[]>(
      `SELECT mt.user_id, t.* FROM tags t
       JOIN member_tags mt ON mt.tag_id = t.id
       WHERE mt.server_id = ? AND mt.user_id IN (${userIds.map(() => '?').join(',')})`,
      [serverId, ...userIds]
    );
    for (const t of tags) {
      if (!tagMap.has(t.user_id)) tagMap.set(t.user_id, []);
      tagMap.get(t.user_id)!.push(t);
    }
  }

  // Fetch replies if any
  const replyIds = messages.filter(m => m.reply_to_id).map(m => m.reply_to_id);
  const replyMap = new Map<string, any>();
  if (replyIds.length > 0) {
    const replies = await query<any[]>(
      `SELECT m.id, m.content, m.sender_id, u.username, u.display_name, u.avatar_url
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id IN (${replyIds.map(() => '?').join(',')})`,
      replyIds
    );
    for (const rep of replies) {
      replyMap.set(rep.id, rep);
    }
  }

  return messages.map(m => ({
    ...m,
    is_edited: Boolean(m.is_edited),
    is_pinned: Boolean(m.is_pinned),
    type: m.type || 'text',
    call_metadata: typeof m.call_metadata === 'string' ? JSON.parse(m.call_metadata) : (m.call_metadata || null),
    sender: userMap.get(m.sender_id),
    attachments: attachmentMap.get(m.id) || [],
    reactions: reactionMap.get(m.id) || {},
    reply_to: m.reply_to_id ? replyMap.get(m.reply_to_id) || null : null,
    member_roles: roleMap.get(m.sender_id) || [],
    member_tags: tagMap.get(m.sender_id) || []
  }));
}

// 1. Get channel messages
const handleGetChannelMessages = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId || req.params.id;
    const limit = Math.min(100, parseInt(req.query.limit as string || '50', 10));
    const before = req.query.before as string | undefined;

    // Get channel server
    const channelRows = await query<any[]>('SELECT server_id FROM channels WHERE id = ?', [channelId]);
    if (!channelRows || channelRows.length === 0) {
      res.status(404).json({ error: 'Csatorna nem található' });
      return;
    }
    const serverId = channelRows[0].server_id;

    // Verify server membership
    const member = await query<any[]>(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?',
      [serverId, req.user!.id]
    );
    if (!member || member.length === 0) {
      res.status(403).json({ error: 'Nem vagy tagja ennek a szervernek' });
      return;
    }

    let sql = 'SELECT * FROM messages WHERE channel_id = ?';
    const params: any[] = [channelId];

    if (before) {
      sql += ' AND created_at < (SELECT created_at FROM messages WHERE id = ?)';
      params.push(before);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await query<any[]>(sql, params);
    // Reverse to chronological order (oldest to newest)
    rows.reverse();

    const populated = await populateMessages(rows, serverId);
    res.json(populated);
  } catch (error) {
    console.error('Fetch channel messages error:', error);
    res.status(500).json({ error: 'Hiba az üzenetek lekérésekor' });
  }
};

router.get('/channels/:channelId', authenticateToken, handleGetChannelMessages);
router.get('/channels/:channelId/messages', authenticateToken, handleGetChannelMessages);

// 2. Send channel message (with optional file uploads)
const handleSendChannelMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId || req.params.id;
    const { content, reply_to_id } = req.body;
    const files = req.files as Express.Multer.File[] | undefined;
    const senderId = req.user!.id;

    if ((!content || !content.trim()) && (!files || files.length === 0)) {
      res.status(400).json({ error: 'Az üzenet nem lehet üres!' });
      return;
    }

    const channelRows = await query<any[]>('SELECT server_id FROM channels WHERE id = ?', [channelId]);
    if (!channelRows || channelRows.length === 0) {
      res.status(404).json({ error: 'Csatorna nem található' });
      return;
    }
    const serverId = channelRows[0].server_id;

    // Check permissions
    const canSend = await hasPermission(serverId, senderId, 'SEND_MESSAGES');
    if (!canSend) {
      res.status(403).json({ error: 'Nincs jogosultságod üzenetet küldeni ebbe a csatornába!' });
      return;
    }

    if (files && files.length > 0) {
      const canAttach = await hasPermission(serverId, senderId, 'ATTACH_FILES');
      if (!canAttach) {
        res.status(403).json({ error: 'Nincs jogosultságod fájlokat csatolni!' });
        return;
      }
    }

    const messageId = uuidv4();

    await withTransaction(async (conn) => {
      await conn.query(
        'INSERT INTO messages (id, channel_id, sender_id, content, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [messageId, channelId, senderId, (content || '').trim(), reply_to_id || null]
      );

      if (files && files.length > 0) {
        for (const f of files) {
          const fileUrl = `/uploads/${f.filename}`;
          await conn.query(
            'INSERT INTO attachments (id, message_id, filename, original_name, mime_type, size_bytes, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [uuidv4(), messageId, f.filename, f.originalname, f.mimetype, f.size, fileUrl]
          );
        }
      }
    });

    const msgRows = await query<any[]>('SELECT * FROM messages WHERE id = ?', [messageId]);
    const populated = await populateMessages(msgRows, serverId);
    res.status(201).json(populated[0]);
  } catch (error) {
    console.error('Send channel message error:', error);
    res.status(500).json({ error: 'Hiba az üzenet küldésekor' });
  }
};

router.post('/channels/:channelId', authenticateToken, uploadMiddleware.array('files', 10), handleSendChannelMessage);
router.post('/channels/:channelId/messages', authenticateToken, uploadMiddleware.array('files', 10), handleSendChannelMessage);

// 3. Get DM conversations list
const handleGetDMsList = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Find all users with whom current user has DM messages
    const partners = await query<any[]>(
      `SELECT DISTINCT
         CASE WHEN sender_id = ? THEN dm_recipient_id ELSE sender_id END as partner_id
       FROM messages
       WHERE channel_id IS NULL AND (sender_id = ? OR dm_recipient_id = ?)`,
      [userId, userId, userId]
    );

    if (partners.length === 0) {
      res.json([]);
      return;
    }

    const partnerIds = partners.map(p => p.partner_id).filter(Boolean);
    const users = await query<any[]>(
      `SELECT id, username, display_name, avatar_url, banner_color, bio, custom_status, status, badges, created_at
       FROM users WHERE id IN (${partnerIds.map(() => '?').join(',')})`,
      partnerIds
    );

    // Get last message for each conversation
    const conversations = [];
    for (const u of users) {
      const lastMsgRows = await query<any[]>(
        `SELECT * FROM messages
         WHERE channel_id IS NULL AND (
           (sender_id = ? AND dm_recipient_id = ?) OR
           (sender_id = ? AND dm_recipient_id = ?)
         )
         ORDER BY created_at DESC LIMIT 1`,
        [userId, u.id, u.id, userId]
      );

      conversations.push({
        user: {
          ...u,
          badges: typeof u.badges === 'string' ? JSON.parse(u.badges) : u.badges || []
        },
        lastMessage: lastMsgRows[0] || null
      });
    }

    // Sort by last message timestamp
    conversations.sort((a, b) => {
      const tA = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0;
      const tB = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0;
      return tB - tA;
    });

    res.json(conversations);
  } catch (error) {
    console.error('Fetch DMs list error:', error);
    res.status(500).json({ error: 'Hiba a privát beszélgetések lekérésekor' });
  }
};

router.get('/', authenticateToken, handleGetDMsList);
router.get('/dms', authenticateToken, handleGetDMsList);

// 4. Get DM messages with a specific user
const handleGetDMMessages = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const recipientId = req.params.recipientId || req.params.id;
    const userId = req.user!.id;
    const limit = Math.min(100, parseInt(req.query.limit as string || '50', 10));
    const before = req.query.before as string | undefined;

    let sql = `SELECT * FROM messages
               WHERE channel_id IS NULL AND (
                 (sender_id = ? AND dm_recipient_id = ?) OR
                 (sender_id = ? AND dm_recipient_id = ?)
               )`;
    const params: any[] = [userId, recipientId, recipientId, userId];

    if (before) {
      sql += ' AND created_at < (SELECT created_at FROM messages WHERE id = ?)';
      params.push(before);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await query<any[]>(sql, params);
    rows.reverse();

    const populated = await populateMessages(rows, null);
    res.json(populated);
  } catch (error) {
    console.error('Fetch DM messages error:', error);
    res.status(500).json({ error: 'Hiba a privát üzenetek lekérésekor' });
  }
};

router.get('/dms/:recipientId', authenticateToken, handleGetDMMessages);
router.get('/dms/:recipientId/messages', authenticateToken, handleGetDMMessages);
router.get('/:recipientId', authenticateToken, handleGetDMMessages);
router.get('/:recipientId/messages', authenticateToken, handleGetDMMessages);

// 5. Send DM message
const handleSendDM = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const recipientId = req.params.recipientId || req.params.id || req.body.recipient_id || req.body.recipientId;
    const { content, reply_to_id, type, call_metadata } = req.body;
    const files = req.files as Express.Multer.File[] | undefined;
    const senderId = req.user!.id;

    if (!recipientId) {
      res.status(400).json({ error: 'Címzett azonosítója kötelező!' });
      return;
    }

    if ((!content || !content.trim()) && (!files || files.length === 0)) {
      res.status(400).json({ error: 'Az üzenet nem lehet üres!' });
      return;
    }

    // Check if target user exists
    const targetUser = await query<any[]>('SELECT id FROM users WHERE id = ?', [recipientId]);
    if (!targetUser || targetUser.length === 0) {
      res.status(404).json({ error: 'A címzett nem található!' });
      return;
    }

    // Check if blocked
    const isBlocked = await query<any[]>(
      'SELECT id FROM blocked_users WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)',
      [senderId, recipientId, recipientId, senderId]
    );
    if (isBlocked && isBlocked.length > 0) {
      res.status(403).json({ error: 'Nem küldhetsz üzenetet ennek a felhasználónak tiltás miatt!' });
      return;
    }

    const messageId = uuidv4();
    const msgType = type || 'text';
    const metadataStr = call_metadata ? (typeof call_metadata === 'string' ? call_metadata : JSON.stringify(call_metadata)) : null;

    await withTransaction(async (conn) => {
      await conn.query(
        'INSERT INTO messages (id, dm_recipient_id, sender_id, content, type, call_metadata, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [messageId, recipientId, senderId, (content || '').trim(), msgType, metadataStr, reply_to_id || null]
      );

      if (files && files.length > 0) {
        for (const f of files) {
          const fileUrl = `/uploads/${f.filename}`;
          await conn.query(
            'INSERT INTO attachments (id, message_id, filename, original_name, mime_type, size_bytes, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [uuidv4(), messageId, f.filename, f.originalname, f.mimetype, f.size, fileUrl]
          );
        }
      }
    });

    const msgRows = await query<any[]>('SELECT * FROM messages WHERE id = ?', [messageId]);
    const populated = await populateMessages(msgRows, null);
    res.status(201).json(populated[0]);
  } catch (error) {
    console.error('Send DM error:', error);
    res.status(500).json({ error: 'Hiba a privát üzenet küldésekor' });
  }
};

router.post('/dms', authenticateToken, uploadMiddleware.array('files', 10), handleSendDM);
router.post('/dms/:recipientId', authenticateToken, uploadMiddleware.array('files', 10), handleSendDM);
router.post('/dms/:recipientId/messages', authenticateToken, uploadMiddleware.array('files', 10), handleSendDM);
router.post('/:recipientId', authenticateToken, uploadMiddleware.array('files', 10), handleSendDM);
router.post('/:recipientId/messages', authenticateToken, uploadMiddleware.array('files', 10), handleSendDM);

// 5b. Log Call Event
const handleLogCallEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { recipientId, channelId, status, duration, startedAt, endedAt } = req.body;
    const callerId = req.user!.id;
    const callId = uuidv4();
    const messageId = uuidv4();

    const durationSec = parseInt(duration || '0', 10);
    const durationFormatted = durationSec > 60
      ? `${Math.floor(durationSec / 60)} perc ${durationSec % 60} mp`
      : `${durationSec} mp`;

    let content = '📞 Hívás véget ért';
    if (status === 'started') {
      content = '📞 Hívás kezdeményezve';
    } else if (status === 'missed') {
      content = '📞 Nem fogadott hívás';
    } else if (durationSec > 0) {
      content = `📞 Hívás véget ért (${durationFormatted})`;
    }

    const callMeta = {
      callId,
      callerId,
      receiverId: recipientId || null,
      channelId: channelId || null,
      status: status || 'ended',
      duration: durationSec,
      durationFormatted,
      startedAt: startedAt || new Date().toISOString(),
      endedAt: endedAt || new Date().toISOString()
    };

    // Save to call_logs
    await query(
      `INSERT INTO call_logs (id, caller_id, receiver_id, channel_id, status, duration, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))`,
      [callId, callerId, recipientId || null, channelId || null, status || 'ended', durationSec, startedAt || null, endedAt || null]
    );

    // Save message
    await query(
      `INSERT INTO messages (id, channel_id, dm_recipient_id, sender_id, content, type, call_metadata, created_at)
       VALUES (?, ?, ?, ?, ?, 'call', ?, NOW())`,
      [messageId, channelId || null, recipientId || null, callerId, content, JSON.stringify(callMeta)]
    );

    const msgRows = await query<any[]>('SELECT * FROM messages WHERE id = ?', [messageId]);
    const populated = await populateMessages(msgRows, null);
    res.status(201).json(populated[0]);
  } catch (error) {
    console.error('Log call event error:', error);
    res.status(500).json({ error: 'Hiba a hívásnaplózáskor' });
  }
};

router.post('/calls/event', authenticateToken, handleLogCallEvent);
router.post('/dms/:recipientId/call-event', authenticateToken, handleLogCallEvent);

// 6. Edit message (PUT & PATCH, /:messageId & /messages/:messageId)
const handleEditMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const messageId = req.params.messageId || req.params.id;
    const { content } = req.body;
    const userId = req.user!.id;

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Az üzenet nem lehet üres!' });
      return;
    }

    const msgs = await query<any[]>('SELECT * FROM messages WHERE id = ?', [messageId]);
    if (!msgs || msgs.length === 0) {
      res.status(404).json({ error: 'Üzenet nem található' });
      return;
    }

    if (msgs[0].sender_id !== userId) {
      res.status(403).json({ error: 'Csak a saját üzenetedet szerkesztheted!' });
      return;
    }

    await query('UPDATE messages SET content = ?, is_edited = TRUE WHERE id = ?', [content.trim(), messageId]);

    const updated = await query<any[]>('SELECT * FROM messages WHERE id = ?', [messageId]);
    let serverId: string | null = null;
    if (updated[0].channel_id) {
      const ch = await query<any[]>('SELECT server_id FROM channels WHERE id = ?', [updated[0].channel_id]);
      serverId = ch[0]?.server_id || null;
    }

    const populated = await populateMessages(updated, serverId);
    res.json(populated[0]);
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Hiba az üzenet szerkesztésekor' });
  }
};

router.put('/:messageId', authenticateToken, handleEditMessage);
router.patch('/:messageId', authenticateToken, handleEditMessage);
router.put('/messages/:messageId', authenticateToken, handleEditMessage);
router.patch('/messages/:messageId', authenticateToken, handleEditMessage);

// 7. Delete message (DELETE /:messageId & /messages/:messageId)
const handleDeleteMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const messageId = req.params.messageId || req.params.id;
    const userId = req.user!.id;

    const msgs = await query<any[]>('SELECT * FROM messages WHERE id = ?', [messageId]);
    if (!msgs || msgs.length === 0) {
      res.status(404).json({ error: 'Üzenet nem található' });
      return;
    }

    const msg = msgs[0];
    let canDelete = msg.sender_id === userId;

    if (!canDelete && msg.channel_id) {
      const ch = await query<any[]>('SELECT server_id FROM channels WHERE id = ?', [msg.channel_id]);
      if (ch && ch.length > 0) {
        canDelete = await hasPermission(ch[0].server_id, userId, 'MANAGE_MESSAGES');
      }
    }

    if (!canDelete) {
      res.status(403).json({ error: 'Nincs jogosultságod törölni ezt az üzenetet!' });
      return;
    }

    await query('DELETE FROM messages WHERE id = ?', [messageId]);
    res.json({ message: 'Üzenet sikeresen törölve' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Hiba az üzenet törlésekor' });
  }
};

router.delete('/:messageId', authenticateToken, handleDeleteMessage);
router.delete('/messages/:messageId', authenticateToken, handleDeleteMessage);

// 8. Add or Toggle Emoji Reaction
const handleAddReaction = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const messageId = req.params.messageId || req.params.id;
    const { emoji } = req.body;
    const userId = req.user!.id;

    if (!emoji || !emoji.trim()) {
      res.status(400).json({ error: 'Emoji megadása kötelező!' });
      return;
    }

    const cleanEmoji = emoji.trim();

    // Check existing reaction
    const existing = await query<any[]>(
      'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [messageId, userId, cleanEmoji]
    );

    if (existing && existing.length > 0) {
      // Toggle off
      await query('DELETE FROM message_reactions WHERE id = ?', [existing[0].id]);
    } else {
      // Add reaction
      await query(
        'INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, NOW())',
        [uuidv4(), messageId, userId, cleanEmoji]
      );
    }

    // Return updated reactions for message
    const allReactions = await query<any[]>(
      `SELECT mr.*, u.username
       FROM message_reactions mr
       JOIN users u ON u.id = mr.user_id
       WHERE mr.message_id = ?`,
      [messageId]
    );

    const reactionSummary: Record<string, { count: number; users: string[]; reacted: boolean }> = {};
    for (const r of allReactions) {
      if (!reactionSummary[r.emoji]) {
        reactionSummary[r.emoji] = { count: 0, users: [], reacted: false };
      }
      reactionSummary[r.emoji].count++;
      reactionSummary[r.emoji].users.push(r.username);
      if (r.user_id === userId) {
        reactionSummary[r.emoji].reacted = true;
      }
    }

    res.json({ reactions: reactionSummary });
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ error: 'Hiba a reakció kezelésekor' });
  }
};

router.post('/:messageId/reactions', authenticateToken, handleAddReaction);
router.post('/messages/:messageId/reactions', authenticateToken, handleAddReaction);

// 9. Remove specific emoji reaction
const handleDeleteReaction = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const messageId = req.params.messageId || req.params.id;
    const { reaction: emoji } = req.params;
    const userId = req.user!.id;

    await query(
      'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [messageId, userId, decodeURIComponent(emoji)]
    );

    res.json({ message: 'Reakció eltávolítva' });
  } catch (error) {
    console.error('Delete reaction error:', error);
    res.status(500).json({ error: 'Hiba a reakció törlésekor' });
  }
};

router.delete('/:messageId/reactions/:reaction', authenticateToken, handleDeleteReaction);
router.delete('/messages/:messageId/reactions/:reaction', authenticateToken, handleDeleteReaction);

export default router;
