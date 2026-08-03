import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { Notification } from '../messenger/models/notifications.model';
import { Conversation } from '../messenger/models/conversation.model';
import { Message } from '../messenger/models/message.model';
import { MessageTypeEnum } from '../messenger/interfaces/message.interface';
import { logger } from '../utils/logger';

/*
 * Read-only. Answers "why does the badge say 2 when one message arrived?" by
 * comparing the stored counter against ground truth.
 *
 *   npx ts-node src/scripts/diagnose-notifications.ts
 *
 * unread_count is now derived rather than incremented, so this should report no
 * drift once every row has been touched by a message, a read receipt, or a
 * load. Rows that predate the change keep their old $inc-ed value until then —
 * expect drift on those, and expect it to disappear as they are used.
 *
 * Duplicate (user, conversation) rows are the one thing that does not self-heal
 * and must be collapsed with dedupe-notifications before the unique index will
 * build.
 *
 * Mirrors deriveUnreadCount: messages in the conversation, not sent by this
 * user, not INFO, newer than max(last read message's timestamp, seen_at),
 * capped the same way.
 */
const UNREAD_COUNT_CAP = 99;

const diagnose = async (): Promise<void> => {
  await connectDB();

  // 1. Duplicate rows for the same (user, conversation).
  const duplicates = await Notification.aggregate<{
    _id: {
      user: mongoose.Types.ObjectId;
      conversation: mongoose.Types.ObjectId;
    };
    count: number;
    counts: number[];
  }>([
    {
      $group: {
        _id: { user: '$user', conversation: '$conversation' },
        count: { $sum: 1 },
        counts: { $push: '$unread_count' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicates.length > 0) {
    logger.warn(
      `${duplicates.length} duplicated (user, conversation) pair(s). Each message increments only one row while every row is published, so the badge lands on whichever publish arrived last:`,
    );
    for (const dup of duplicates.slice(0, 20)) {
      logger.warn(
        `  user=${dup._id.user} conversation=${dup._id.conversation} rows=${dup.count} counts=[${dup.counts.join(', ')}]`,
      );
    }
  } else {
    logger.info('No duplicate (user, conversation) rows.');
  }

  // 2. Stored counter vs. actual unread messages.
  const notifications = await Notification.find({})
    .select('user conversation unread_count seen seen_at')
    .lean();

  let checked = 0;
  let drifted = 0;
  const driftHistogram = new Map<number, number>();

  for (const notif of notifications) {
    const conversation = await Conversation.findById(notif.conversation)
      .select('read_receipts')
      .lean();
    if (!conversation) continue;

    const receipt = conversation.read_receipts?.find(
      (r) => r.user_id?.toString() === notif.user.toString(),
    );

    // The receipt's own read_at comes off the client's clock; the read
    // message's server-assigned timestamp is what the service uses.
    const lastRead = receipt?.last_message_read_id
      ? await Message.findById(receipt.last_message_read_id)
          .select('timestamp')
          .lean()
      : null;

    const watermarks = [lastRead?.timestamp, notif.seen_at].filter(
      (d): d is Date => !!d,
    );

    const query: Record<string, unknown> = {
      conversation: notif.conversation,
      sender: { $ne: notif.user },
      type: { $ne: MessageTypeEnum.INFO },
    };

    // No watermark at all means nothing has been read, so everything counts.
    if (watermarks.length > 0) {
      query['timestamp'] = {
        $gt: new Date(Math.max(...watermarks.map((d) => d.getTime()))),
      };
    }

    // Capped the same way deriveUnreadCount caps it. Counting uncapped here
    // reported permanent drift on any conversation past 99 unread, where the
    // service is storing 99 on purpose.
    const actual = await Message.countDocuments(query, {
      limit: UNREAD_COUNT_CAP,
    });
    const stored = notif.seen ? 0 : (notif.unread_count ?? 0);

    checked++;
    if (stored !== actual) {
      drifted++;
      const drift = stored - actual;
      driftHistogram.set(drift, (driftHistogram.get(drift) ?? 0) + 1);
      if (drifted <= 20) {
        logger.warn(
          `  user=${notif.user} conversation=${notif.conversation} stored=${stored} actual=${actual} drift=${drift > 0 ? '+' : ''}${drift}`,
        );
      }
    }
  }

  logger.info(`Checked ${checked} notification row(s); ${drifted} drifted.`);
  if (driftHistogram.size > 0) {
    const summary = [...driftHistogram.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([drift, n]) => `${drift > 0 ? '+' : ''}${drift}: ${n} row(s)`)
      .join(', ');
    logger.info(`Drift distribution — ${summary}`);
  }

  await mongoose.disconnect();
};

diagnose().catch((error) => {
  logger.error('Diagnosis failed:', error);
  process.exit(1);
});
