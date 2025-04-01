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
  sender: string;
  conversation: string;
  content: string;
  type: MessageType;
  status: MessageStatus;
  readBy?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}
