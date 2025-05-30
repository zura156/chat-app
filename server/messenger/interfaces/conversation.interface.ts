import { ReadReceiptI } from './read-receipt.interface';

export interface ConversationI {
  _id?: string;
  participants: string[];
  last_message?: string;
  read_receipts: ReadReceiptI[];
  is_group: boolean;
  group_name?: string;
  group_picture?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
