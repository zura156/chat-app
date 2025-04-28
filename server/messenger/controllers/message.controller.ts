import { Response, NextFunction } from 'express';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { Message } from '../models/message.model';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';

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
