import { ConversationI } from './conversation.interface';
import { ParticipantI } from './participant.interface';

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
}

export enum MessageStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

export interface MessageI {
  _id?: string;
  sender: ParticipantI;
  conversation: ConversationI;
  content: string;
  type: MessageType;
  status?: MessageStatus;
  readBy?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}
