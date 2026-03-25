import { ConversationI } from './conversation.interface';
import { ParticipantI } from './participant.interface';

export enum MessageType {
  INFO = 'info',
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
}

export enum MessageStatus {
  FAILED = 'failed',
  SENDING = 'sending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}
export interface FileI {
  url: string;
  placeholder_url?: string;
  thumbnail_url?: string;
  duration?: number;
  name: string;
  mime_type: string;
  size_in_bytes: number;
}

export interface MessageI {
  _id?: string;
  tempId?: string;
  sender: Partial<ParticipantI>;
  conversation: ConversationI | string;
  file?: FileI;
  content: string;
  type: MessageType;
  status: MessageStatus;
  timestamp: string;
  edited_at?: string;
}

export interface GroupedMessages {
  timeframe: string;
  messages: MessageI[];
}

// Add this method to your class
export function convertToMessageType(type: string): MessageType {
  switch (type) {
    case 'info':
      return MessageType.INFO;
    case 'text':
      return MessageType.TEXT;
    case 'image':
      return MessageType.IMAGE;
    case 'file':
      return MessageType.FILE;
    // Add other cases as needed
    default:
      return MessageType.TEXT; // Default fallback
  }
}
