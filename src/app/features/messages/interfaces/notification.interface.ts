import { ConversationI } from './conversation.interface';

export interface NotificationI {
  _id: string;
  conversation: Partial<ConversationI>;
  unread_count: number;
  seen: boolean;
}
