import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { Notification } from '../messenger/models/notifications.model';
import { Conversation } from '../messenger/models/conversation.model';
import { Message } from '../messenger/models/message.model';
import { MessageTypeEnum } from '../messenger/interfaces/message.interface';
import { logger } from '../utils/logger';

/*
 * One-off, for rows written before unread_count became a derived value.
 *
 *   npm run backfill:notifications           # dry run, writes nothing
 *   npm run backfill:notifications -- --apply
 *
 * The old counter was an $inc maintained from the moment a user joined a
 * conversation. The new one counts messages newer than the user's watermark,
 * and a user added to an existing conversation has no watermark until
 * seedNotificationWatermarks gives them one — which only happens for joins from
 * now on. Every row that predates it therefore derives the conversation's whole
 * history as unread.
 *
 * Observed on a real row: a user added to a group nine minutes after it was
 * created stored 14, which was correct, while the new derivation returned 21 —
 * the 14 messages since they joined plus 7 they were never there for. The first
 * load after deploy would have replaced the right answer with the wrong one.
 *
 * So the stored value is treated as the truth and a watermark is fabricated to
 * reproduce it: seen_at becomes the timestamp of the (stored + 1)-th newest
 * message that would otherwise count, leaving exactly `stored` above it. Rows
 * whose derivation already agrees are left alone, which is every row written
 * since the refactor.
 */

const UNREAD_QUERY = (conversation: mongoose.Types.ObjectId, user: mongoose.Types.ObjectId) => ({
  conversation,
  sender: { $ne: user },
  type: { $ne: MessageTypeEnum.INFO },
});

const backfill = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');

  await connectDB();

  if (!apply) {
    logger.info('DRY RUN — pass --apply to write. Nothing will be modified.');
  }

  const notifications = await Notification.find({})
    .select('user conversation unread_count seen seen_at')
    .lean();

  let examined = 0;
  let planned = 0;
  let skippedAlreadyCorrect = 0;

  for (const notif of notifications) {
    examined++;

    const conversation = await Conversation.findById(notif.conversation)
      .select('read_receipts')
      .lean();

    // Orphaned rows are the refresh path's problem, not this one.
    if (!conversation) continue;

    const receipt = conversation.read_receipts?.find(
      (r) => r.user_id?.toString() === notif.user.toString(),
    );

    const lastRead = receipt?.last_message_read_id
      ? await Message.findById(receipt.last_message_read_id)
          .select('timestamp')
          .lean()
      : null;

    const watermarks = [lastRead?.timestamp, notif.seen_at].filter(
      (d): d is Date => !!d,
    );

    const base = UNREAD_QUERY(notif.conversation, notif.user);
    const current = watermarks.length
      ? new Date(Math.max(...watermarks.map((d) => d.getTime())))
      : undefined;

    const derived = await Message.countDocuments({
      ...base,
      ...(current ? { timestamp: { $gt: current } } : {}),
    });

    const stored = notif.seen ? 0 : (notif.unread_count ?? 0);

    // Only inflation is repaired. A derivation at or below the stored value
    // means the watermark already bounds the count, and rewriting it would
    // invent unread messages the user has actually read.
    if (derived <= stored) {
      skippedAlreadyCorrect++;
      continue;
    }

    // The (stored + 1)-th newest qualifying message: everything strictly newer
    // than it is exactly the `stored` messages the old counter was counting.
    const boundary = await Message.find(base)
      .sort({ timestamp: -1 })
      .skip(stored)
      .limit(1)
      .select('timestamp')
      .lean();

    if (boundary.length === 0) continue;

    const seenAt = boundary[0].timestamp;
    planned++;

    logger.warn(
      `  user=${notif.user} conversation=${notif.conversation} stored=${stored} derived=${derived} -> seen_at=${seenAt.toISOString()}`,
    );

    if (apply) {
      await Notification.updateOne(
        { _id: notif._id },
        {
          $set: {
            seen_at: seenAt,
            unread_count: stored,
            seen: stored === 0,
          },
        },
      );
    }
  }

  logger.info(
    `Examined ${examined} row(s); ${skippedAlreadyCorrect} already consistent; ${planned} ${
      apply ? 'updated' : 'would be updated'
    }.`,
  );

  if (!apply && planned > 0) {
    logger.info('Re-run with --apply to write these watermarks.');
  }

  await mongoose.disconnect();
};

backfill().catch((error) => {
  logger.error('Backfill failed:', error);
  process.exit(1);
});
