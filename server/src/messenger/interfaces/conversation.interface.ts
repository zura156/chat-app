import { UserDTO } from '../../user/dtos/user.dto';
import { MessageI } from './message.interface';
import { ReadReceiptI } from './read-receipt.interface';

export interface ConversationI {
  _id?: string;
  participants: Partial<UserDTO>[] | string[];
  last_message?: Partial<MessageI> | string;
  read_receipts: ReadReceiptI[];
  is_group: boolean;
  group_name?: string;
  group_picture?: string;
  created_by?: Partial<UserDTO> | string;
  createdAt?: Date;
  updatedAt?: Date;
}
