import { UserI } from '../../user/interfaces/user.interface';
import { ConversationI, ReadReceiptI } from './conversation.interface';
import { MessageI } from './message.interface';
import { ParticipantI } from './participant.interface';

type MessageContentType = 'text' | 'image' | 'audio' | 'video' | 'file';

type WebSocketMessageType =
  | 'authenticate'
  | 'typing'
  | 'message'
  | 'conversation-update'
  | 'conversation-join'
  | 'conversation-leave'
  | 'message-status'
  | MessageContentType
  | 'user-status'
  | 'file-upload';

interface BaseWebSocketMessage {
  type: WebSocketMessageType;
}

export interface AuthenticateMessage extends BaseWebSocketMessage {
  type: 'authenticate';
  user_id: string;
}

export interface TypingMessage extends BaseWebSocketMessage {
  type: 'typing';
  is_typing: boolean;
  sender: Partial<UserI>;
  participants: Partial<UserI>[];
  conversation: string;
}

export interface ConversationUpdateMessage extends BaseWebSocketMessage {
  type: 'conversation-update';
  conversation: ConversationI;
}
export interface ConversationJoinMessage extends BaseWebSocketMessage {
  type: 'conversation-join';
  conversation: Partial<ConversationI>;
  added_by: Partial<UserI>;
  added_users: (Partial<UserI> | string)[];
}

export interface ConversationLeaveMessage extends BaseWebSocketMessage {
  type: 'conversation-leave';
  conversation: Partial<ConversationI>;
  removed_by: Partial<UserI>;
  removed_users: (Partial<UserI> | string)[];
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
  user_id: string;
  status: 'online' | 'offline';
  last_seen?: string;
}

export interface FileUploadMessage extends BaseWebSocketMessage {
  type: 'file-upload';
  user_id: string;
}

export type WebSocketMessageT =
  | ConversationUpdateMessage
  | AuthenticateMessage
  | TypingMessage
  | ChatMessage
  | UserStatusMessage
  | MessageStatusMessage
  | ConversationJoinMessage
  | ConversationLeaveMessage
  | FileUploadMessage;
