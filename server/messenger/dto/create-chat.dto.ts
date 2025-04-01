import { ConversationI } from '../interfaces/conversation.interface';
import { Request } from 'express';

export interface CreateChatDto extends Request {
  body: {
    conversation: ConversationI;
  };
}
