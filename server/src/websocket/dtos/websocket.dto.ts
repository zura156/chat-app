import { MessageI } from '../../messenger/interfaces/message.interface';
import { ConversationI } from '../../messenger/interfaces/conversation.interface';
import { ReadReceiptI } from '../../messenger/interfaces/read-receipt.interface';
import { UserInterface } from '../../user/interfaces/user.interface';

export type MessageContentType = 'text' | 'audio' | 'image' | 'video' | 'file';

export type WebSocketMessageType =
  | 'authenticate'
  | 'typing'
  | 'message'
  | 'conversation-join'
  | 'conversation-update'
  | 'conversation-leave'
  | 'message-status'
  | 'user-status';

export interface BaseWebSocketMessage {
  type: WebSocketMessageType;
}

export interface AuthenticateMessage extends BaseWebSocketMessage {
  type: 'authenticate';
  user_id: string;
}

export interface TypingMessage extends BaseWebSocketMessage {
  type: 'typing';
  is_typing: boolean;
  sender: Partial<UserInterface>;
  participants: Partial<UserInterface>[];
  conversation_id: string;
}

export interface ConversationJoinMessage extends BaseWebSocketMessage {
  type: 'conversation-join';
  conversation: Partial<ConversationI>;
  added_by?: Partial<UserInterface> | string;
  added_users?: (Partial<UserInterface> | string)[];
}

export interface ConversationUpdateMessage extends BaseWebSocketMessage {
  type: 'conversation-update';
  conversation: Partial<ConversationI>;
}

export interface ConversationLeaveMessage extends BaseWebSocketMessage {
  type: 'conversation-leave';
  conversation: Partial<ConversationI>;
  removed_by?: Partial<UserInterface> | string;
  removed_users?: (Partial<UserInterface> | string)[];
}

export interface ChatMessage extends BaseWebSocketMessage {
  type: 'message';
  message: MessageI;
  participants: Partial<UserInterface>[];
}

export interface MessageStatusMessage extends BaseWebSocketMessage {
  type: 'message-status';
  read_receipt: ReadReceiptI;
  conversation_id: string;
}

export interface UserStatusMessage extends BaseWebSocketMessage {
  type: 'user-status';
  user_id: string;
  status: 'online' | 'offline';
  last_seen?: string;
}

export type WebSocketMessage =
  | AuthenticateMessage
  | TypingMessage
  | ConversationJoinMessage
  | ConversationLeaveMessage
  | ChatMessage
  | MessageStatusMessage
  | UserStatusMessage;
