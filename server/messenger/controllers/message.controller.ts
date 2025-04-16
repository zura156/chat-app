import { Response, NextFunction } from 'express';
import { SendMessageDto } from '../dto/send-message.dto';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { saveMessage } from '../services/message.service';
import { createNotification } from '../services/notification.service';
import { Message } from '../models/message.model';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';

export const sendMessage = async (
  req: SendMessageDto,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { sender, conversation, content, type } = req.body.message;

    const message = await saveMessage({ sender, conversation, content, type });

    if (!message) {
      next(createCustomError('Error saving message!', 500));
      return;
    }

    // Create notifications for all participants (except the sender)
    await createNotification(sender, conversation, JSON.stringify(message._id));

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

export const getMessagesByConversationId = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const conversationId = req.params.conversationId;
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!userId || !conversationId) {
      next(createCustomError('User ID and Conversation ID are required', 400));
      return;
    }

    const [messages, totalCount] = await Promise.all([
      Message.find({ conversation: conversationId })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .populate('sender', 'username profile_picture'),

      Message.countDocuments({ conversation: conversationId }),
    ]);
    res.status(200).json({ messages, totalCount });
  } catch (error) {
    console.error('Error fetching messages:', error);
    next(createCustomError('Failed to fetch messages', 500));
  }
};
