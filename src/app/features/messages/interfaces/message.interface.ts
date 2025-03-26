import { ConversationI } from "./conversation.interface";
import { ParticipantI } from "./participant.interface";

export interface MessageI {
  _id: string;
  sender: ParticipantI;
  conversation: ConversationI;
  content: string;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE' | 'SYSTEM';
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  readBy: string[];
  createdAt: string;
  updatedAt: string;
}
