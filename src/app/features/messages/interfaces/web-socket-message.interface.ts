import { UserI } from '../../user/interfaces/user.interface';
import { ReadReceiptI } from './conversation.interface';
import { MessageI } from './message.interface';
import { ParticipantI } from './participant.interface';

type MessageContentType = 'text' | 'image' | 'video' | 'file';

type WebSocketMessageType =
  | 'authenticate'
  | 'typing'
  | 'message'
  | 'conversation-join'
  | 'conversation-leave'
  | 'message-status'
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

export interface ConversationJoinMessage extends BaseWebSocketMessage {
  type: 'conversation-join';
  conversation_id: string;
  added_by: Partial<UserI>;
  added_user: Partial<UserI>;
}

export interface ConversationLeaveMessage extends BaseWebSocketMessage {
  type: 'conversation-leave';
  conversation_id: string;
  removed_by: Partial<UserI>;
  removed_user: Partial<UserI>;
}

export interface ChatMessage extends BaseWebSocketMessage {
  type: 'message' | MessageContentType;
  message: MessageI;
  participants: Partial<ParticipantI>[];
}

export interface MessageStatusMessage extends BaseWebSocketMessage {
  type: 'message-status';
  read_receipt: ReadReceiptI;
  status: 'sent' | 'delivered' | 'read';
  conversation_id: string;
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
  | UserStatusMessage
  | MessageStatusMessage
  | ConversationJoinMessage
  | ConversationLeaveMessage;
