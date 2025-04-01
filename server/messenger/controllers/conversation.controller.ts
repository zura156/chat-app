import { Request, Response, NextFunction } from 'express';
import { CreateChatDto } from '../dto/create-chat.dto';
import { createConversation } from '../services/conversation.service';

export const createChat = async (
  req: CreateChatDto,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { conversation } = req.body;

    const chat = await createConversation(conversation);
  } catch (e) {}
};
