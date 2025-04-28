import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { sendMessageToUser } from '../services/websocket.service';
import { Response } from 'express';

export const apiSendMessageToUser = (req: AuthRequest, res: Response) => {
  const { message } = req.body;
  const userId = req.user?.userId;

  if (!userId || !message) {
    return res.status(400).json({ error: 'Missing userId or message' });
  }

  sendMessageToUser(userId, message);
  return res.status(200).json({ success: true });
};
