export interface User {
  id: string;
  name: string;
  email?: string;
}

export interface ConversationMember {
  id: string;
  name: string;
  lastReadId: number;
}

export interface Message {
  id: number;
  conversationId: string;
  senderId: string;
  clientId: string;
  text: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  name: string | null;
  createdAt?: string;
  members: ConversationMember[];
  lastMessage: Message | null;
  unreadCount: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type ClientEvent =
  | { type: 'message'; conversationId: string; clientId: string; text: string }
  | { type: 'typing'; conversationId: string; typing: boolean }
  | { type: 'read'; conversationId: string; messageId: number };

export type ServerEvent =
  | { type: 'ready'; onlineUserIds: string[] }
  | { type: 'conversation'; conversation: Conversation; onlineUserIds: string[] }
  | { type: 'message'; message: Message }
  | { type: 'read'; conversationId: string; userId: string; messageId: number }
  | { type: 'presence'; userId: string; online: boolean }
  | { type: 'typing'; conversationId: string; userId: string; typing: boolean }
  | { type: 'error'; clientId?: string; error: string };

export interface ApiError extends Error {
  status?: number;
}
