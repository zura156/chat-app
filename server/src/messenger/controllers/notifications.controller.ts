import { Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Notification } from '../models/notifications.model';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';

export const markNotificationsAsSeen = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new Types.ObjectId(req.user?.userId);
    await Notification.updateMany(
      { user: userId, seen: false },
      { seen: true }
    );

    res.status(200).json({ message: 'Notifications marked as seen' });
  } catch (error) {
    next(error);
  }
};
