import { UserInterface } from '../../user/interfaces/user.interface';

export enum MessageTypeEnum {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
}

export enum MessageStatusEnum {
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
  timestamp: Date;
  edited_at?: Date;
}

export const getMessageTypeFromMime = (mimeType: string): MessageTypeEnum => {
  const type = mimeType.split('/')[0];
  switch (type) {
    case 'image':
      return MessageTypeEnum.IMAGE;
    case 'video':
      return MessageTypeEnum.VIDEO;
    case 'audio':
      return MessageTypeEnum.AUDIO;
    default:
      return MessageTypeEnum.FILE;
  }
};
