import { MessageI } from './message.interface';
import { ParticipantI } from './participant.interface';

export interface ConversationI {
  _id: string;
  participants: ParticipantI[];
  lastMessage?: MessageI;
  createdAt: string;
  updatedAt: string;
}
