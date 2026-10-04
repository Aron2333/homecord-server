-- ============================================================================
-- OTPCord Production Database Schema
-- Host Target: mysql.rackhost.hu / MySQL 8.0+ & MariaDB 10.5+
-- Charset: utf8mb4 | Collation: utf8mb4_unicode_ci
-- Generated for OTPCord Production Architecture (api.otpcord.hu)
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- ----------------------------------------------------------------------------
-- 1. System Permissions Reference Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_permissions (
  name VARCHAR(64) PRIMARY KEY,
  description VARCHAR(255) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Badges Reference Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badges (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT NULL,
  icon_url VARCHAR(512) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Users Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  display_name VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(512) DEFAULT NULL,
  banner_color VARCHAR(16) NOT NULL DEFAULT '#5865F2',
  status ENUM('online', 'idle', 'dnd', 'invisible', 'offline') NOT NULL DEFAULT 'offline',
  custom_status VARCHAR(128) DEFAULT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT TRUE,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_username (username),
  INDEX idx_users_email (email),
  INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. User Profiles Table (Extended Profile Data)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id VARCHAR(36) PRIMARY KEY,
  bio TEXT DEFAULT NULL,
  theme ENUM('dark', 'light') NOT NULL DEFAULT 'dark',
  allow_dms_from_strangers BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_uprof_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. User Badges (Many-to-Many)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_badges (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  badge_id VARCHAR(36) NOT NULL,
  awarded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_badge (user_id, badge_id),
  CONSTRAINT fk_ub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ub_badge FOREIGN KEY (badge_id) REFERENCES badges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. Sessions & Refresh Tokens
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  refresh_token VARCHAR(512) NOT NULL UNIQUE,
  user_agent VARCHAR(255) DEFAULT NULL,
  ip_address VARCHAR(64) DEFAULT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_refresh (refresh_token),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 7. Friendships
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friendships (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  friend_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_friendship (user_id, friend_id),
  INDEX idx_friendship_user (user_id),
  INDEX idx_friendship_friend (friend_id),
  CONSTRAINT fk_friends_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friends_friend FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 8. Friend Requests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friend_requests (
  id VARCHAR(36) PRIMARY KEY,
  sender_id VARCHAR(36) NOT NULL,
  receiver_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_friend_request (sender_id, receiver_id),
  INDEX idx_freq_receiver (receiver_id, status),
  INDEX idx_freq_sender (sender_id, status),
  CONSTRAINT fk_freq_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_freq_receiver FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 9. Blocked Users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocked_users (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  blocked_user_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blocked_user (user_id, blocked_user_id),
  INDEX idx_blocked_user (user_id),
  CONSTRAINT fk_block_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_block_target FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 10. Servers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  icon_url VARCHAR(512) DEFAULT NULL,
  owner_id VARCHAR(36) NOT NULL,
  description TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_servers_owner (owner_id),
  CONSTRAINT fk_servers_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 11. Server Roles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  name VARCHAR(64) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#99AAB5',
  position INT NOT NULL DEFAULT 0,
  hoist BOOLEAN NOT NULL DEFAULT FALSE,
  mentionable BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_roles_server_pos (server_id, position),
  CONSTRAINT fk_roles_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 12. Role Permissions (Granular Permissions per Role)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  id VARCHAR(36) PRIMARY KEY,
  role_id VARCHAR(36) NOT NULL,
  permission_name VARCHAR(64) NOT NULL,
  UNIQUE KEY uq_role_permission (role_id, permission_name),
  INDEX idx_rperm_role (role_id),
  CONSTRAINT fk_rperm_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rperm_name FOREIGN KEY (permission_name) REFERENCES system_permissions(name) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 13. Server Members
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS server_members (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  nickname VARCHAR(64) DEFAULT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_server_member (server_id, user_id),
  INDEX idx_sm_server (server_id),
  INDEX idx_sm_user (user_id),
  CONSTRAINT fk_sm_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 14. Member Roles (Many-to-Many)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_roles (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role_id VARCHAR(36) NOT NULL,
  UNIQUE KEY uq_member_role (server_id, user_id, role_id),
  INDEX idx_mr_server_user (server_id, user_id),
  INDEX idx_mr_role (role_id),
  CONSTRAINT fk_mr_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CONSTRAINT fk_mr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mr_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 15. Server Tags (e.g. [DEV], [ADMIN], [STAFF], [VIP])
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS server_tags (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  name VARCHAR(16) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#3BA55D',
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stags_server (server_id),
  CONSTRAINT fk_stags_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 16. User Server Tags (Many-to-Many)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_server_tags (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  tag_id VARCHAR(36) NOT NULL,
  UNIQUE KEY uq_user_server_tag (server_id, user_id, tag_id),
  INDEX idx_ust_server_user (server_id, user_id),
  CONSTRAINT fk_ust_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CONSTRAINT fk_ust_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ust_tag FOREIGN KEY (tag_id) REFERENCES server_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 17. Server Invites
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS server_invites (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  server_id VARCHAR(36) NOT NULL,
  inviter_id VARCHAR(36) NOT NULL,
  max_uses INT NOT NULL DEFAULT 0,
  uses INT NOT NULL DEFAULT 0,
  expires_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invites_server (server_id),
  INDEX idx_invites_code (code),
  CONSTRAINT fk_inv_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_user FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 18. Channels (Includes CATEGORY, TEXT, VOICE)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channels (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  category_id VARCHAR(36) DEFAULT NULL,
  name VARCHAR(64) NOT NULL,
  type ENUM('TEXT', 'VOICE', 'CATEGORY') NOT NULL DEFAULT 'TEXT',
  topic VARCHAR(512) DEFAULT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_channels_server_pos (server_id, position),
  INDEX idx_channels_category (category_id),
  CONSTRAINT fk_chan_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CONSTRAINT fk_chan_category FOREIGN KEY (category_id) REFERENCES channels(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 19. Channel Permissions Overrides
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_permissions (
  id VARCHAR(36) PRIMARY KEY,
  channel_id VARCHAR(36) NOT NULL,
  role_id VARCHAR(36) DEFAULT NULL,
  user_id VARCHAR(36) DEFAULT NULL,
  permission_name VARCHAR(64) NOT NULL,
  allow BOOLEAN NOT NULL DEFAULT TRUE,
  INDEX idx_cperm_channel (channel_id),
  CONSTRAINT fk_cperm_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  CONSTRAINT fk_cperm_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_cperm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cperm_name FOREIGN KEY (permission_name) REFERENCES system_permissions(name) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 20. Messages (Channel Messages and 1-on-1 Direct Messages)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(36) PRIMARY KEY,
  channel_id VARCHAR(36) DEFAULT NULL,
  dm_recipient_id VARCHAR(36) DEFAULT NULL,
  sender_id VARCHAR(36) NOT NULL,
  content TEXT NOT NULL,
  reply_to_id VARCHAR(36) DEFAULT NULL,
  is_edited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_msg_channel_time (channel_id, created_at),
  INDEX idx_msg_dm_pair (sender_id, dm_recipient_id, created_at),
  INDEX idx_msg_reply (reply_to_id),
  CONSTRAINT fk_msg_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_recipient FOREIGN KEY (dm_recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_reply FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 21. Message Attachments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_attachments (
  id VARCHAR(36) PRIMARY KEY,
  message_id VARCHAR(36) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  size_bytes BIGINT NOT NULL,
  url VARCHAR(512) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_att_message (message_id),
  CONSTRAINT fk_att_msg FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 22. Message Reactions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_reactions (
  id VARCHAR(36) PRIMARY KEY,
  message_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  emoji VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_msg_reaction (message_id, user_id, emoji),
  INDEX idx_mr_msg (message_id),
  CONSTRAINT fk_react_msg FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_react_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 23. Emojis (Custom Server Emojis)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emojis (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  name VARCHAR(32) NOT NULL,
  image_url VARCHAR(512) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_emojis_server (server_id),
  CONSTRAINT fk_emojis_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 24. Stickers (Custom Server Stickers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stickers (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  name VARCHAR(32) NOT NULL,
  image_url VARCHAR(512) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stickers_server (server_id),
  CONSTRAINT fk_stickers_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 25. Voice Sessions (Active Voice Participants)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_sessions (
  id VARCHAR(36) PRIMARY KEY,
  channel_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  is_muted BOOLEAN NOT NULL DEFAULT FALSE,
  is_deafened BOOLEAN NOT NULL DEFAULT FALSE,
  is_screensharing BOOLEAN NOT NULL DEFAULT FALSE,
  is_video BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_voice_user (user_id),
  INDEX idx_vs_channel (channel_id),
  CONSTRAINT fk_vs_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  CONSTRAINT fk_vs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 26. Screen Share Sessions (Active 720p-1440p Streams)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS screen_share_sessions (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 27. Server Bans
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS server_bans (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  reason TEXT DEFAULT NULL,
  banned_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_server_user_ban (server_id, user_id),
  INDEX idx_bans_server (server_id),
  CONSTRAINT fk_bans_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CONSTRAINT fk_bans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_bans_actor FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 28. Audit Logs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL,
  actor_id VARCHAR(36) NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_id VARCHAR(36) DEFAULT NULL,
  target_type VARCHAR(32) DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_server_time (server_id, created_at),
  CONSTRAINT fk_audit_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 29. Notifications Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- DEFAULT SEED DATA (System Permissions & Base Badges)
-- ============================================================================

INSERT IGNORE INTO system_permissions (name, description, category) VALUES
  ('ADMINISTRATOR', 'Minden jogosultsággal rendelkezik, felülbírálja az összes korlátozást.', 'ADMIN'),
  ('MANAGE_SERVER', 'Módosíthatja a szerver nevét, ikonját, leírását.', 'ADMIN'),
  ('MANAGE_CHANNELS', 'Létrehozhat, módosíthat és törölhet csatornákat és kategóriákat.', 'CHANNELS'),
  ('MANAGE_ROLES', 'Létrehozhat és módosíthat nála alacsonyabb rangokat.', 'ROLES'),
  ('MANAGE_MEMBERS', 'Kezelheti a tagok rangjait és beceneveit.', 'MEMBERS'),
  ('KICK_MEMBERS', 'Kirúghat alacsonyabb rangú tagokat a szerverről.', 'MEMBERS'),
  ('BAN_MEMBERS', 'Kitilthat alacsonyabb rangú tagokat a szerverről.', 'MEMBERS'),
  ('MANAGE_MESSAGES', 'Törölheti más tagok üzeneteit a csatornákban.', 'MESSAGES'),
  ('SEND_MESSAGES', 'Küldhet üzeneteket a szöveges csatornákba.', 'MESSAGES'),
  ('READ_MESSAGES', 'Olvashatja a csatorna üzeneteit.', 'MESSAGES'),
  ('ATTACH_FILES', 'Feltölthet és csatolhat fájlokat és képeket.', 'MESSAGES'),
  ('CONNECT_VOICE', 'Csatlakozhat a hangcsatornákhoz.', 'VOICE'),
  ('SPEAK', 'Beszélhet a hangcsatornában.', 'VOICE'),
  ('MUTE_MEMBERS', 'Elnémíthat más tagokat a hangcsatornában.', 'VOICE'),
  ('DEAFEN_MEMBERS', 'Elsüketíthet más tagokat a hangcsatornában.', 'VOICE'),
  ('MOVE_MEMBERS', 'Áthelyezhet tagokat másik hangcsatornába.', 'VOICE'),
  ('MANAGE_INVITES', 'Létrehozhat és visszavonhat meghívókódokat.', 'GENERAL'),
  ('MANAGE_EMOJIS', 'Feltölthet és kezelhet egyedi emojikat.', 'CONTENT'),
  ('MANAGE_STICKERS', 'Feltölthet és kezelhet szerver matricákat.', 'CONTENT'),
  ('MANAGE_TAGS', 'Létrehozhat és kioszthat egyedi szerver tageket ([DEV], [ADMIN]).', 'GENERAL'),
  ('MENTION_EVERYONE', 'Használhatja a @everyone és @here megemlítéseket.', 'MESSAGES');

INSERT IGNORE INTO badges (id, name, description, icon_url) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'Early User', 'Az OTPCord korai felhasználója', '/assets/badges/early_user.png'),
  ('b1000000-0000-0000-0000-000000000002', 'Developer', 'OTPCord fejlesztő és közreműködő', '/assets/badges/developer.png'),
  ('b1000000-0000-0000-0000-000000000003', 'Server Owner', 'Egy OTPCord szerver tulajdonosa', '/assets/badges/owner.png'),
  ('b1000000-0000-0000-0000-000000000004', 'Staff', 'OTPCord hivatalos munkatárs', '/assets/badges/staff.png'),
  ('b1000000-0000-0000-0000-000000000005', 'Moderator', 'Kiemelt közösségi moderátor', '/assets/badges/mod.png');
