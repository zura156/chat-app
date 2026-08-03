import { Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Notification } from '../models/notifications.model';
import { refreshNotificationsForUser } from '../services/notification.service';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';

export const markNotificationsAsSeen = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = new Types.ObjectId(req.user?._id.toString());
    const { conversationId } = req.body ?? {};

    const filter: Record<string, unknown> = { user: userId, seen: false };
    if (conversationId && Types.ObjectId.isValid(conversationId)) {
      filter['conversation'] = new Types.ObjectId(conversationId);
    }

    // seen_at is the watermark for a dismissal. Without it the derived count
    // recomputes from the read receipt alone and resurrects everything the user
    // dismissed without opening.
    await Notification.updateMany(filter, {
      $set: { seen: true, unread_count: 0, seen_at: new Date() },
    });

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

    // Recompute before serving: the stored counts are a cache, and this is the
    // point where any drift a race left behind gets corrected.
    const { muted } = await refreshNotificationsForUser(userId);

    // A mute suppresses the realtime push, so without this the badge came back
    // on the next load — the one place the count is read rather than pushed.
    const notifications = await Notification.find({
      user: userId,
      ...(muted.size > 0
        ? {
            conversation: {
              $nin: [...muted].map((id) => new Types.ObjectId(id)),
            },
          }
        : {}),
    })
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
