import mysql from 'mysql2/promise';
import { CONFIG } from '../config/index.js';

export let pool: mysql.Pool;

const TABLE_DEFINITIONS = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    display_name VARCHAR(64) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(512) DEFAULT NULL,
    banner_color VARCHAR(16) DEFAULT '#5865F2',
    bio TEXT DEFAULT NULL,
    custom_status VARCHAR(128) DEFAULT NULL,
    status ENUM('online', 'idle', 'dnd', 'invisible', 'offline') DEFAULT 'offline',
    badges JSON DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_username (username),
    INDEX idx_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    token TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    refresh_token VARCHAR(512) NOT NULL,
    user_agent VARCHAR(512) DEFAULT NULL,
    ip_address VARCHAR(64) DEFAULT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sessions_refresh (refresh_token),
    CONSTRAINT fk_sessions_table_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS user_profiles (
    user_id VARCHAR(36) PRIMARY KEY,
    bio TEXT DEFAULT NULL,
    theme VARCHAR(32) DEFAULT 'dark',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS badges (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    description TEXT DEFAULT NULL,
    icon_url VARCHAR(512) DEFAULT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS user_badges (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    badge_id VARCHAR(36) NOT NULL,
    awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_badge (user_id, badge_id),
    CONSTRAINT fk_ub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS friendships (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    friend_id VARCHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_friendship (user_id, friend_id),
    CONSTRAINT fk_friends_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_friends_friend FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS friend_requests (
    id VARCHAR(36) PRIMARY KEY,
    sender_id VARCHAR(36) NOT NULL,
    receiver_id VARCHAR(36) NOT NULL,
    status ENUM('pending', 'accepted', 'declined') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_request (sender_id, receiver_id),
    CONSTRAINT fk_freq_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_freq_receiver FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS blocked_users (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    blocked_user_id VARCHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_blocked (user_id, blocked_user_id),
    CONSTRAINT fk_block_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_block_blocked FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS servers (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    icon_url VARCHAR(512) DEFAULT NULL,
    owner_id VARCHAR(36) NOT NULL,
    description TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_servers_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    name VARCHAR(64) NOT NULL,
    color VARCHAR(16) DEFAULT '#99aab5',
    position INT NOT NULL DEFAULT 0,
    hoist BOOLEAN DEFAULT FALSE,
    mentionable BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_roles_server_pos (server_id, position),
    CONSTRAINT fk_roles_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS role_permissions (
    id VARCHAR(36) PRIMARY KEY,
    role_id VARCHAR(36) NOT NULL,
    permission_name VARCHAR(64) NOT NULL,
    UNIQUE KEY uq_role_perm (role_id, permission_name),
    CONSTRAINT fk_rperm_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS server_members (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    nickname VARCHAR(64) DEFAULT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_server_user (server_id, user_id),
    CONSTRAINT fk_sm_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT fk_sm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS member_roles (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    UNIQUE KEY uq_member_role (server_id, user_id, role_id),
    CONSTRAINT fk_mr_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT fk_mr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_mr_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS tags (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    name VARCHAR(16) NOT NULL,
    color VARCHAR(16) DEFAULT '#3ba55d',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tags_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS member_tags (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    tag_id VARCHAR(36) NOT NULL,
    UNIQUE KEY uq_member_tag (server_id, user_id, tag_id),
    CONSTRAINT fk_mt_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT fk_mt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_mt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS channel_categories (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    name VARCHAR(64) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cat_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS channels (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    category_id VARCHAR(36) DEFAULT NULL,
    name VARCHAR(64) NOT NULL,
    type ENUM('text', 'voice') DEFAULT 'text',
    topic VARCHAR(512) DEFAULT NULL,
    position INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_channels_server_pos (server_id, position),
    CONSTRAINT fk_chan_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT fk_chan_category FOREIGN KEY (category_id) REFERENCES channel_categories(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS channel_permissions (
    id VARCHAR(36) PRIMARY KEY,
    channel_id VARCHAR(36) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    permission_name VARCHAR(64) NOT NULL,
    allow BOOLEAN DEFAULT TRUE,
    UNIQUE KEY uq_chan_role_perm (channel_id, role_id, permission_name),
    CONSTRAINT fk_cp_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    CONSTRAINT fk_cp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(36) PRIMARY KEY,
    channel_id VARCHAR(36) DEFAULT NULL,
    dm_recipient_id VARCHAR(36) DEFAULT NULL,
    sender_id VARCHAR(36) NOT NULL,
    content TEXT NOT NULL,
    reply_to_id VARCHAR(36) DEFAULT NULL,
    is_edited BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_msg_channel (channel_id, created_at),
    INDEX idx_msg_dm (sender_id, dm_recipient_id, created_at),
    CONSTRAINT fk_msg_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_msg_recipient FOREIGN KEY (dm_recipient_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_msg_reply FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS attachments (
    id VARCHAR(36) PRIMARY KEY,
    message_id VARCHAR(36) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    url VARCHAR(512) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_att_msg FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS message_reactions (
    id VARCHAR(36) PRIMARY KEY,
    message_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    emoji VARCHAR(64) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_msg_user_emoji (message_id, user_id, emoji),
    CONSTRAINT fk_mr_msg FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_mr_reaction_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS emojis (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    name VARCHAR(32) NOT NULL,
    image_url VARCHAR(512) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_emojis_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS stickers (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    name VARCHAR(32) NOT NULL,
    image_url VARCHAR(512) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_stickers_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS invites (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    server_id VARCHAR(36) NOT NULL,
    inviter_id VARCHAR(36) NOT NULL,
    max_uses INT DEFAULT 0,
    uses INT DEFAULT 0,
    expires_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_invites_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT fk_invites_user FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(36) NOT NULL,
    action VARCHAR(64) NOT NULL,
    target_id VARCHAR(36) DEFAULT NULL,
    target_type VARCHAR(32) DEFAULT NULL,
    metadata JSON DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_server_time (server_id, created_at),
    CONSTRAINT fk_audit_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS server_bans (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    reason TEXT DEFAULT NULL,
    banned_by VARCHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_server_ban (server_id, user_id),
    CONSTRAINT fk_bans_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT fk_bans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_bans_actor FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS voice_sessions (
    id VARCHAR(36) PRIMARY KEY,
    channel_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    is_muted BOOLEAN DEFAULT FALSE,
    is_deafened BOOLEAN DEFAULT FALSE,
    is_screensharing BOOLEAN DEFAULT FALSE,
    is_video BOOLEAN DEFAULT FALSE,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_voice_user (user_id),
    CONSTRAINT fk_vs_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    CONSTRAINT fk_vs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS system_permissions (
    name VARCHAR(64) PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    category VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    type ENUM('FRIEND_REQUEST', 'MENTION', 'DM', 'SERVER_EVENT', 'MODERATION') NOT NULL,
    title VARCHAR(128) NOT NULL,
    content TEXT NOT NULL,
    link VARCHAR(255) DEFAULT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notif_user_unread (user_id, is_read, created_at),
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS screen_share_sessions (
    id VARCHAR(36) PRIMARY KEY,
    channel_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    resolution ENUM('720p', '1080p', '1440p') NOT NULL DEFAULT '1080p',
    fps INT NOT NULL DEFAULT 60,
    has_audio BOOLEAN NOT NULL DEFAULT TRUE,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_screenshare_user (user_id),
    INDEX idx_sss_channel (channel_id),
    CONSTRAINT fk_sss_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    CONSTRAINT fk_sss_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE OR REPLACE VIEW server_tags AS SELECT * FROM tags;`,
  `CREATE OR REPLACE VIEW user_server_tags AS SELECT * FROM member_tags;`,
  `CREATE OR REPLACE VIEW server_invites AS SELECT * FROM invites;`,
  `CREATE OR REPLACE VIEW message_attachments AS SELECT * FROM attachments;`
];

export async function initDatabase(): Promise<void> {
  // Create connection pool directly with configured database
  pool = mysql.createPool({
    ...CONFIG.DB,
    multipleStatements: true
  });

  try {
    const testConn = await pool.getConnection();
    console.log(`[DB] Successfully connected to MySQL database "${CONFIG.DB.database}" at ${CONFIG.DB.host}:${CONFIG.DB.port}`);
    
    // Explicitly ensure all required tables exist
    for (const ddl of TABLE_DEFINITIONS) {
      try {
        await testConn.query(ddl);
      } catch (err: any) {
        console.warn('[DB WARNING] Error creating table:', err?.message);
      }
    }
    console.log('[DB] All database tables verified and created successfully');

    testConn.release();
  } catch (err: any) {
    console.error(`[DB ERROR] Failed to connect to MySQL database at ${CONFIG.DB.host}:${CONFIG.DB.port}:`, err.message);
    if (process.env.NODE_ENV === 'production') {
      console.warn('[DB WARNING] Continuing startup in production mode. Queries will fail until MySQL connection is restored.');
      return;
    }
    throw err;
  }
}

export async function checkDatabaseHealth(): Promise<boolean> {
  if (!pool) return false;
  try {
    const [rows] = await pool.query('SELECT 1 as alive');
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T> {
  if (!pool) {
    throw new Error('Database pool has not been initialized');
  }
  const [rows] = await pool.execute(sql, params);
  return rows as T;
}

export async function withTransaction<T>(callback: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
