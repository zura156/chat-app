import { MessageI } from './message.interface';

export interface MessageListI {
  messages: MessageI[];
  totalCount: number;
}
