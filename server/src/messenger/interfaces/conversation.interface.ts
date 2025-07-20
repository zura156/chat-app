import { UserInterface } from '../../user/interfaces/user.interface';
import { MessageI } from './message.interface';
import { ReadReceiptI } from './read-receipt.interface';

export interface ConversationI {
  _id?: string;
  participants: Partial<UserInterface>[] | string[];
  last_message?: Partial<MessageI> | string;
  read_receipts: ReadReceiptI[];
  is_group: boolean;
  group_name?: string;
  group_picture?: string;
  created_by?: Partial<UserInterface> | string;
  createdAt?: Date;
  updatedAt?: Date;
}
