import { Request } from 'express';
import { MessageI } from '../interfaces/message.interface';

export interface SendMessageDto extends Request {
  body: {
    message: MessageI;
  };
}
