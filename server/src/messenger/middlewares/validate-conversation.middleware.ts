import { Response, NextFunction } from 'express';
import { Conversation } from '../models/conversation.model';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { ObjectId } from 'mongodb';

export async function validateConversation(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const conversationId = req.params.id;
    const { id: userId } = req.user!;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Check if user has access (could be based on different criteria)
    const hasAccess =
      conversation.participants.includes(new ObjectId(userId));
    if (!hasAccess) {
      res.status(403).json({ error: 'Access denied to this conversation' });
      return;
    }

    req.conversation = conversation;
    next();
  } catch (error) {
    console.error('Error validating conversation:', error);
    res.status(500).json({ error: 'Error validating conversation' });
  }
}
