import { Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Notification } from '../models/notifications.model';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';

export const markNotificationsAsSeen = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = new Types.ObjectId(req.user?._id.toString());
    await Notification.updateMany(
      { user: userId, seen: false },
      { seen: true },
    );

    res.status(200).json({ message: 'Notifications marked as seen' });
  } catch (error) {
    next(error);
  }
};

export const getNotifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = new Types.ObjectId(req.user?._id.toString());
    const notifications = await Notification.find({ user: userId })
      .populate(
        'conversation',
        'group_name group_picture participants is_group',
      )
      .sort({ _id: -1 });

    res.status(200).json({ notifications });
  } catch (error) {
    next(error);
  }
};
