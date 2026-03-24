import { Notification } from '../models/notifications.model';
import { MutedConversation } from '../models/muted-conversation.model';
import { Conversation } from '../models/conversation.model';
import { Types } from 'mongoose';
import { redisClient } from '../../utils/redis';

export const createNotification = async (
  senderId: string,
  conversationId: string,
  messageId: string,
): Promise<void> => {
  const conversationObjectId = new Types.ObjectId(conversationId);

  const conversation = await Conversation.findById(conversationObjectId)
    .select('participants')
    .lean();

  if (!conversation) return;

  const mutedDocs = await MutedConversation.find({
    conversation: conversationObjectId,
    user: { $in: conversation.participants },
  })
    .select('user')
    .lean();

  const mutedUserIds = new Set(mutedDocs.map((m) => m.user.toString()));

  const bulkOps = conversation.participants
    .filter((p) => p.toString() !== senderId && !mutedUserIds.has(p.toString()))
    .map((participantId) => ({
      updateOne: {
        filter: { user: participantId, conversation: conversationObjectId },
        update: {
          $inc: { unread_count: 1 },
          $set: { last_message: new Types.ObjectId(messageId), seen: false },
        },
        upsert: true,
      },
    }));

  if (bulkOps.length > 0) {
    await Notification.bulkWrite(bulkOps);
  }

  const updatedNotifs = await Notification.find({
    conversation: conversationObjectId,
    user: {
      $in: conversation.participants.filter((p) => p.toString() !== senderId),
    },
  });

  for (const notif of updatedNotifs) {
    await redisClient.publish(
      'ws:notification',
      JSON.stringify({
        userId: notif.user.toString(),
        notification: {
          type: 'notification',
          conversationId: conversationId,
          unread_count: notif.unread_count,
          seen: notif.seen,
        },
      }),
    );
  }
};
