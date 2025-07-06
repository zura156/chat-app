import { Response, NextFunction } from 'express';
import { Conversation } from '../models/conversation.model';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';

export async function validateConversation(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const conversation = await Conversation.findById(id);

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Cache it on req so downstream handlers can use it
    req.conversation = conversation;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Error validating conversation' });
  }
}
