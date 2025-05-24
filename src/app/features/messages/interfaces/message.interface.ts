import { ConversationI } from './conversation.interface';
import { ParticipantI } from './participant.interface';

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
}

export interface ReadReceipt {
  user_id: string;
  read_at: Date | null;
}

export enum MessageStatus {
  FAILED = 'failed',
  SENDING = 'sending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

export interface MessageI {
  _id?: string;
  sender: Partial<ParticipantI>;
  conversation: ConversationI | string;
  content: string;
  type: MessageType;
  status: MessageStatus;
  readReceipts: ReadReceipt[];
  createdAt: string;
  updatedAt?: string;
}

export interface GroupedMessages {
  timeframe: string;
  messages: MessageI[];
}

// Add this method to your class
export function convertToMessageType(type: string): MessageType {
  switch (type) {
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
