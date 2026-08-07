import { Response, NextFunction } from 'express';
import { Conversation } from '../models/conversation.model';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { ObjectId } from 'mongodb';
import { logger } from '../../utils/logger';

export async function validateConversation(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const conversationId = String(req.params.id ?? '');
    const userId = req.user!._id.toString();

    // Without this an invalid id throws a CastError and surfaces as a 500
    if (!ObjectId.isValid(conversationId)) {
      res
        .status(400)
        .json({
          message: 'Invalid conversation id',
          error: 'Invalid conversation id',
        });
      return;
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      res
        .status(404)
        .json({
          message: 'Conversation not found',
          error: 'Conversation not found',
        });
      return;
    }

    const hasAccess = conversation.participants.some(
      (participantId) => String(participantId) === userId,
    );
    if (!hasAccess) {
      res
        .status(403)
        .json({
          message: 'Access denied to this conversation',
          error: 'Access denied to this conversation',
        });
      return;
    }

    req.conversation = conversation;
    next();
  } catch (error) {
    logger.error('Error validating conversation', error);
    next(error);
  }
}
