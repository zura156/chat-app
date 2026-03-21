import { UserDTO } from '../../user/dtos/user.dto';
import { IFile } from '../models/message.model';

export enum MessageTypeEnum {
  INFO = 'info',
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
}

export enum MessageStatusEnum {
  FAILED = 'failed',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

export interface MessageI {
  sender: Partial<UserDTO> | string;
  conversation: string;
  content: string;
  file?: IFile;
  type: MessageTypeEnum;
  status?: MessageStatusEnum;
  readBy?: string[];
  timestamp: Date;
  edited_at?: Date;
}

export const getMessageTypeFromMime = (mimeType: string): MessageTypeEnum => {
  const type = mimeType.split('/')[0];
  switch (type) {
    case 'text':
      return MessageTypeEnum.TEXT;
    case 'info':
      return MessageTypeEnum.INFO;
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
