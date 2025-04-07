import { MessageI } from './message.interface';
import { ParticipantI } from './participant.interface';

export interface ConversationI {
  _id: string;
  _v?: string;
  participants: ParticipantI[];
  last_message?: MessageI;
  createdAt?: string;
  updatedAt?: string;
  is_group: boolean;
  group_name?: string;
  group_picture?: string;
}
