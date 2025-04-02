import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { ConversationI } from '../interfaces/conversation.interface';

export interface ChatDto extends AuthRequest {
  body: {
    conversation: ConversationI;
  };
}
