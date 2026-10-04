export interface User {
  id: string;
  username: string;
  display_name: string;
  email: string;
  password_hash?: string;
  avatar_url: string | null;
  banner_color: string;
  bio: string | null;
  custom_status: string | null;
  status: 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
  badges: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface UserPublic {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  banner_color: string;
  bio: string | null;
  custom_status: string | null;
  status: 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
  badges: string[] | null;
  created_at: string;
}

export interface Server {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  server_id: string;
  name: string;
  color: string;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  is_default: boolean;
  permissions?: string[];
  created_at: string;
}

export interface Tag {
  id: string;
  server_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ChannelCategory {
  id: string;
  server_id: string;
  name: string;
  position: number;
  created_at: string;
  channels?: Channel[];
}

export interface Channel {
  id: string;
  server_id: string;
  category_id: string | null;
  name: string;
  type: 'text' | 'voice';
  topic: string | null;
  position: number;
  created_at: string;
}

export interface Message {
  id: string;
  channel_id: string | null;
  dm_recipient_id: string | null;
  sender_id: string;
  content: string;
  reply_to_id: string | null;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  sender?: UserPublic;
  reply_to?: Message | null;
  attachments?: Attachment[];
  reactions?: { [emoji: string]: { count: number; users: string[]; reacted: boolean } };
  member_roles?: Role[];
  member_tags?: Tag[];
}

export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  created_at: string;
}

export interface VoiceParticipant {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  screenShareQuality?: string;
  isVideo: boolean;
  isSpeaking?: boolean;
}
