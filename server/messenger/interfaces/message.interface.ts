export enum MessageTypeEnum {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
}

export enum MessageStatusEnum {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

export interface MessageI {
  sender: string;
  conversation: string;
  content: string;
  type: MessageTypeEnum;
  status: MessageStatusEnum;
  readBy?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}
