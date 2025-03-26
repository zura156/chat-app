import { MessageI } from "./message.interface";

export interface WebSocketMessageI {
  type: 'authenticate' | 'send_message' | 'new_message';
  token?: string;
  content?: string;
  conversationId?: string;
  message?: MessageI;
}
