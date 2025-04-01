import { Request, Response, NextFunction } from 'express';
import { SendMessageDto } from '../dto/send-message.dto';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { Conversation } from '../models/conversation.model';
import { saveMessage } from '../services/message.service';

export const sendMessage = async (
  req: SendMessageDto,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { sender, conversation, content, type } = req.body.message;

    // Fetch the conversation from the database
    const chat = await Conversation.findById(conversation);

    if (!chat) {
      return next(createCustomError('Conversation not found', 404));
    }

    // If it's a group chat, send message to all participants
    const isGroupChat = chat.is_group;

    const message = await saveMessage({
      from: sender,
      to: isGroupChat
        ? null
        : chat.participants
            .find((id) => id.toString() !== sender)
            ?.toString() || null, // `null` for group chat
      message: content,
      type,
      conversationId: conversation, // Include conversation ID explicitly
      isGroup: isGroupChat, // Pass group chat flag
    });

    res.status(201).json(message);
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
      return;
    }
    console.error(error);
    next(createCustomError('Error sending message!', 500));
  }
};
