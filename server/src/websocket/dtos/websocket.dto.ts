import { MessageI } from '../../messenger/interfaces/message.interface';
import { ConversationI } from '../../messenger/interfaces/conversation.interface';
import { ReadReceiptI } from '../../messenger/interfaces/read-receipt.interface';
import { UserDTO } from '../../user/dtos/user.dto';

export type MessageContentType = 'text' | 'audio' | 'image' | 'video' | 'file';

export type WebSocketMessageType =
  | 'authenticate'
  | 'typing'
  | 'message'
  | 'conversation-join'
  | 'conversation-update'
  | 'conversation-leave'
  | 'message-status'
  | 'user-status'
  | 'upload-ready'
  | 'upload-infected';

export interface BaseWebSocketMessage {
  type: WebSocketMessageType;
}

/*
 ? Upload flow interfaces
 * these are sent from the file processing workers to the
 * WebSocketController to notify clients about upload status
 * changes. They are not sent by clients, so they don't need
 * to extend BaseWebSocketMessage, but we do include the
 * 'type' field for easy identification.
 */
export interface UploadReadyMessage extends BaseWebSocketMessage {
  type: 'upload-ready';
  uploadId: string;
  context: string;
  variants: Record<string, string>;
  duration?: number; // for audio/video length in seconds
}

export interface UploadInfectedMessage extends BaseWebSocketMessage {
  type: 'upload-infected';
  uploadId: string;
  context: string;
  viruses: string[];
}

export interface AuthenticateMessage extends BaseWebSocketMessage {
  type: 'authenticate';
  user_id: string;
}

export interface TypingMessage extends BaseWebSocketMessage {
  type: 'typing';
  is_typing: boolean;
  sender: Partial<UserDTO>;
  participants: Partial<UserDTO>[];
  conversation_id: string;
}

export interface ConversationJoinMessage extends BaseWebSocketMessage {
  type: 'conversation-join';
  conversation: Partial<ConversationI>;
  added_by?: Partial<UserDTO> | string;
  added_users?: (Partial<UserDTO> | string)[];
}

export interface ConversationUpdateMessage extends BaseWebSocketMessage {
  type: 'conversation-update';
  conversation: Partial<ConversationI>;
}

export interface ConversationLeaveMessage extends BaseWebSocketMessage {
  type: 'conversation-leave';
  conversation: Partial<ConversationI>;
  removed_by?: Partial<UserDTO> | string;
  removed_users?: (Partial<UserDTO> | string)[];
}

export interface ChatMessage extends BaseWebSocketMessage {
  type: 'message';
  message: MessageI;
  participants: Partial<UserDTO>[];
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
  | MessageStatusMessage
  | UserStatusMessage
  | UploadReadyMessage
  | UploadInfectedMessage;
