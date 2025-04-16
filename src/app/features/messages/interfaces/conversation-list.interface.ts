import { ConversationI } from './conversation.interface';

export interface ConversationListI {
  conversations: ConversationI[];
  totalCount: number;
}
