import { ConversationI } from './conversation.interface';
import { ParticipantI } from './participant.interface';

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
}

export enum MessageStatus {
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
  status?: MessageStatus;
  readBy?: string[];
  createdAt?: string;
  updatedAt?: string;
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
