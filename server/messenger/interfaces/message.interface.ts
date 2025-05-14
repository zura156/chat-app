import { UserInterface } from "../../user/interfaces/user.interface";

export enum MessageTypeEnum {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
}

export enum MessageStatusEnum {
  SENDING = 'sending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

export interface MessageI {
  sender: Partial<UserInterface>;
  conversation: string;
  content: string;
  type: MessageTypeEnum;
  status: MessageStatusEnum;
  readBy?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}
