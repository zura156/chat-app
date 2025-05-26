import { MessageI } from './message.interface';
import { ParticipantI } from './participant.interface';

export interface ReadReceiptI {
  user_id: string;
  last_message_read_id: string;
  read_at?: Date | null;
}

export interface ConversationI {
  _id: string;
  _v?: string;
  participants: ParticipantI[];
  last_message?: MessageI;
  read_receipts: ReadReceiptI[];
  createdAt?: string;
  updatedAt?: string;
  is_group: boolean;
  group_name?: string;
  group_picture?: string;
}
