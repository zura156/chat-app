import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { Message } from '../messenger/models/message.model';
import { MessageTypeEnum } from '../messenger/interfaces/message.interface';
import { logger } from '../utils/logger';

/*
 * One-off: finish emptying the messages that were deleted before the delete
 * path did it properly.
 *
 * `deleteMessage` used to clear only `content` and `attachments`, leaving
 * `type` and `edited_at` on the row. Those two are a description of the message
 * that no longer exists, and they were still being read: the conversation list
 * captions a contentless message from its type, so a deleted photo went on
 * announcing itself as "📷 Photo" indefinitely, and in the thread the bubble
 * shape is chosen by type, so a deleted video or file was drawn differently
 * from a deleted text. The fix covers everything deleted from now on; the rows
 * already in the database keep leaking until this runs.
 *
 *   npm run strip:deleted          # apply
 *   npm run strip:deleted -- --dry # count only, change nothing
 *
 * Safe to run more than once — the filter only matches rows that still have
 * something to strip, so a second run reports nothing to do.
 */

const strip = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry');

  await connectDB();

  // Deleted rows that are still carrying one or the other. A row whose type is
  // already TEXT and has no `edited_at` is indistinguishable from one this
  // script has already processed, so it is left alone.
  const filter = {
    deleted_at: { $ne: null, $exists: true },
    $or: [
      { type: { $ne: MessageTypeEnum.TEXT } },
      { edited_at: { $exists: true } },
    ],
  };

  const affected = await Message.countDocuments(filter);

  if (affected === 0) {
    logger.info('Nothing to strip: every deleted message is already empty.');
    return;
  }

  if (dryRun) {
    const byType = await Message.aggregate([
      { $match: filter },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    logger.info(`[dry run] ${affected} deleted message(s) would be stripped.`);
    for (const { _id, count } of byType) {
      logger.info(`[dry run]   type=${_id ?? '(unset)'}: ${count}`);
    }
    return;
  }

  // `type` is normalised rather than unset, matching `deleteMessage`: it is a
  // required enum with a default, and every `switch` over it on both sides of
  // the wire is written against real values.
  const result = await Message.updateMany(filter, {
    $set: { type: MessageTypeEnum.TEXT },
    $unset: { edited_at: '' },
  });

  logger.info(
    `Stripped ${result.modifiedCount} of ${affected} deleted message(s).`,
  );
};

strip()
  .catch((error) => {
    logger.error('Strip failed', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
