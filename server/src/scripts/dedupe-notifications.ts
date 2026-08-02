import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { Notification } from '../messenger/models/notifications.model';
import { logger } from '../utils/logger';

/*
 * One-off: collapse duplicate (user, conversation) notification rows so the
 * unique index on NotificationSchema can build.
 *
 * Duplicates exist because the upsert in createNotification filtered on a pair
 * that had no unique constraint behind it — two concurrent messages could both
 * miss and both insert. Run this once against each environment *before*
 * deploying the index, otherwise mongoose logs an index build failure at
 * startup and the collection keeps drifting.
 *
 *   npx ts-node src/scripts/dedupe-notifications.ts
 *
 * The surviving row keeps the highest unread_count of the group, and is
 * unseen if any of its duplicates were unseen — an over-count is recoverable
 * by opening the conversation, a swallowed message is not.
 */
const dedupe = async (): Promise<void> => {
  await connectDB();

  const groups = await Notification.aggregate<{
    _id: {
      user: mongoose.Types.ObjectId;
      conversation: mongoose.Types.ObjectId;
    };
    ids: mongoose.Types.ObjectId[];
    maxUnread: number;
    seen: boolean;
  }>([
    {
      $group: {
        _id: { user: '$user', conversation: '$conversation' },
        ids: { $push: '$_id' },
        maxUnread: { $max: '$unread_count' },
        // false sorts before true, so $min is false if any row was unseen.
        seen: { $min: '$seen' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (groups.length === 0) {
    logger.info('No duplicate notifications found; index is safe to build.');
    await mongoose.disconnect();
    return;
  }

  let removed = 0;

  for (const group of groups) {
    const [keep, ...drop] = group.ids;

    await Notification.updateOne(
      { _id: keep },
      { $set: { unread_count: group.maxUnread, seen: group.seen } },
    );
    const result = await Notification.deleteMany({ _id: { $in: drop } });
    removed += result.deletedCount ?? 0;
  }

  logger.info(
    `Collapsed ${groups.length} duplicated pair(s), removed ${removed} row(s).`,
  );
  await mongoose.disconnect();
};

dedupe().catch((error) => {
  logger.error('Dedupe failed:', error);
  process.exit(1);
});
