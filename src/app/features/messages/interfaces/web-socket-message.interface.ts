import { UserI } from '../../user/interfaces/user.interface';
import { MessageI } from './message.interface';
import { ParticipantI } from './participant.interface';

type MessageContentType = 'text' | 'image' | 'video' | 'file';

type WebSocketMessageType =
  | 'authenticate'
  | 'typing'
  | 'message'
  | MessageContentType
  | 'user-status';
interface BaseWebSocketMessage {
  type: WebSocketMessageType;
}

export interface AuthenticateMessage extends BaseWebSocketMessage {
  type: 'authenticate';
  userId: string;
}

export interface TypingMessage extends BaseWebSocketMessage {
  type: 'typing';
  is_typing: boolean;
  sender: Partial<UserI>;
  participants: Partial<UserI>[];
  conversation: string;
}

export interface ChatMessage extends BaseWebSocketMessage {
  type: 'message' | MessageContentType;
  message: MessageI;
  participants: Partial<ParticipantI>[];
}

export interface UserStatusMessage extends BaseWebSocketMessage {
  type: 'user-status';
  userId: string;
  status: 'online' | 'offline';
  last_seen?: string;
}

export type WebSocketMessageT =
  | AuthenticateMessage
  | TypingMessage
  | ChatMessage
  | UserStatusMessage;
