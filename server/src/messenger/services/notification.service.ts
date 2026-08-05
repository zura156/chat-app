import { Notification } from '../models/notifications.model';
import { MutedConversation } from '../models/muted-conversation.model';
import { Conversation, IReadReceipt } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { MessageTypeEnum } from '../interfaces/message.interface';
import { Types } from 'mongoose';
import { redisClient } from '../../config/redis';

/*
 * unread_count used to be a running total maintained with $inc, cleared from
 * three different places. Nothing ever recomputed it, so a single lost clear or
 * repeated increment was permanent — the counter had no way back to the truth,
 * which is what produced badges reading 2 for one new message.
 *
 * It is now derived from the messages collection on every write and every read.
 * The stored number is only a cache; a wrong one survives until the next
 * message or the next load, then corrects itself.
 */

/** Nothing at or before this instant is unread for the user. */
const watermarkOf = (
  lastReadAt: Date | undefined,
  seenAt: Date | undefined,
): Date | undefined => {
  const candidates = [lastReadAt, seenAt].filter((d): d is Date => !!d);
  if (candidates.length === 0) return undefined;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
};

/**
 * Nobody needs an exact count past this — the card renders `9+`. Capping keeps
 * the count off the full history of a long conversation, which matters because
 * this runs once per recipient per message.
 */
const UNREAD_COUNT_CAP = 99;

/**
 * A message the sender took back should not still be sitting in someone's
 * badge. Deletion is soft, so the tombstone has to be excluded explicitly —
 * and by the same clause everywhere the count is derived, or the two paths
 * disagree and the diagnostic reports drift that is not real.
 */
const UNDELETED = { deleted_at: { $exists: false } } as const;

/**
 * Messages in the conversation that this user has not read: not their own, not
 * system info, newer than their watermark. Served by the existing
 * `{conversation, timestamp}` index.
 *
 * No watermark means nothing has ever been read, so everything counts — which
 * is why a user joining an existing conversation gets one seeded at join time.
 */
const deriveUnreadCount = (
  conversation: Types.ObjectId,
  user: Types.ObjectId,
  since: Date | undefined,
): Promise<number> =>
  Message.countDocuments(
    {
      conversation,
      sender: { $ne: user },
      type: { $ne: MessageTypeEnum.INFO },
      ...UNDELETED,
      ...(since ? { timestamp: { $gt: since } } : {}),
    },
    { limit: UNREAD_COUNT_CAP },
  );

/**
 * The same count as deriveUnreadCount, for many conversations at once and for a
 * single user, in one round trip instead of one per conversation.
 *
 * Every conversation carries its own watermark, so the match is an $or over
 * per-conversation clauses; `sender` and `type` are constant across them
 * because the user is. Each branch is served by the same
 * `{conversation, timestamp}` index the per-conversation query uses.
 *
 * Conversations with nothing unread produce no group, so the caller reads a
 * miss as 0 rather than expecting a row back for each.
 *
 * The cap is applied after counting rather than as a limit, which is the one
 * thing this gives up: a conversation sitting on thousands of unread messages
 * is fully counted here and short-circuited at 99 by the single-conversation
 * path. Worth it to turn N queries into one — the counting is index-only, and
 * the alternative is a per-group limit that aggregation has no way to express.
 */
const deriveUnreadCounts = async (
  user: Types.ObjectId,
  targets: { conversation: Types.ObjectId; since: Date | undefined }[],
): Promise<Map<string, number>> => {
  if (targets.length === 0) return new Map();

  const counts = await Message.aggregate<{ _id: Types.ObjectId; n: number }>([
    {
      $match: {
        sender: { $ne: user },
        type: { $ne: MessageTypeEnum.INFO },
        ...UNDELETED,
        $or: targets.map(({ conversation, since }) => ({
          conversation,
          ...(since ? { timestamp: { $gt: since } } : {}),
        })),
      },
    },
    { $group: { _id: '$conversation', n: { $sum: 1 } } },
  ]);

  return new Map(
    counts.map(({ _id, n }) => [
      _id.toString(),
      Math.min(n, UNREAD_COUNT_CAP),
    ]),
  );
};

/**
 * Read receipts store a message id; the watermark needs that message's
 * server-assigned timestamp. Client-supplied `read_at` is not usable here — it
 * comes off the sender's clock.
 *
 * Keyed by message id rather than by user: one user holds a different receipt
 * in every conversation, so a user-keyed map collides as soon as the caller
 * spans more than one.
 */
const timestampsByMessageId = async (
  receipts: IReadReceipt[],
): Promise<Map<string, Date>> => {
  const messageIds = receipts
    .map((receipt) => receipt.last_message_read_id)
    .filter((id): id is Types.ObjectId => !!id);

  if (messageIds.length === 0) return new Map();

  const messages = await Message.find({ _id: { $in: messageIds } })
    .select('timestamp')
    .lean();

  return new Map(
    messages.map((message) => [message._id.toString(), message.timestamp]),
  );
};

/** The user's own receipt in a conversation, resolved to a timestamp. */
const receiptTimestampFor = (
  receipts: IReadReceipt[] | undefined,
  userId: string,
  timestampById: Map<string, Date>,
): Date | undefined => {
  const receipt = receipts?.find((r) => r.user_id?.toString() === userId);
  const messageId = receipt?.last_message_read_id?.toString();
  return messageId ? timestampById.get(messageId) : undefined;
};

const publishNotification = (
  userId: string,
  conversationId: string,
  state: { unread_count: number; seen: boolean },
): Promise<unknown> =>
  redisClient.publish(
    'ws:notification',
    JSON.stringify({
      userId,
      notification: {
        type: 'notification',
        conversationId,
        ...state,
      },
    }),
  );

export const createNotification = async (
  senderId: string,
  conversationId: string,
): Promise<void> => {
  const conversationObjectId = new Types.ObjectId(conversationId);

  const conversation = await Conversation.findById(conversationObjectId)
    .select('participants read_receipts')
    .lean();

  if (!conversation) return;

  const mutedDocs = await MutedConversation.find({
    conversation: conversationObjectId,
    user: { $in: conversation.participants },
  })
    .select('user')
    .lean();

  const mutedUserIds = new Set(mutedDocs.map((m) => m.user.toString()));

  const recipients = conversation.participants.filter(
    (p) => p.toString() !== senderId && !mutedUserIds.has(p.toString()),
  );

  if (recipients.length === 0) return;

  const [timestampById, existing] = await Promise.all([
    timestampsByMessageId(conversation.read_receipts ?? []),
    Notification.find({
      conversation: conversationObjectId,
      user: { $in: recipients },
    })
      .select('user seen_at')
      .lean(),
  ]);

  const seenAtByUser = new Map(
    existing.map((notif) => [notif.user.toString(), notif.seen_at]),
  );

  /*
   * One count per recipient, issued together.
   *
   * This is deliberately not folded into `deriveUnreadCounts`: that batches one
   * user across many conversations, whereas this is many users in one
   * conversation, and the two do not reduce to the same query. Each recipient's
   * count excludes their *own* messages, so two recipients cannot share a
   * result even when they share a watermark.
   *
   * What keeps it acceptable on the hot path: the count is capped at
   * UNREAD_COUNT_CAP, served entirely by the {conversation, timestamp} index,
   * and bounded by the conversation's member limit.
   */
  const counts = await Promise.all(
    recipients.map(async (user) => {
      const key = user.toString();
      return {
        user,
        unread_count: await deriveUnreadCount(
          conversationObjectId,
          user,
          watermarkOf(
            receiptTimestampFor(conversation.read_receipts, key, timestampById),
            seenAtByUser.get(key),
          ),
        ),
      };
    }),
  );

  // seen tracks unread_count everywhere, rather than being hardcoded false
  // here: a recipient who dismissed the conversation in the moment between the
  // message landing and this running derives 0, and 0-but-unseen is a state the
  // client renders as a badge with nothing behind it.
  await Notification.bulkWrite(
    counts.map(({ user, unread_count }) => ({
      updateOne: {
        filter: { user, conversation: conversationObjectId },
        update: { $set: { unread_count, seen: unread_count === 0 } },
        upsert: true,
      },
    })),
  );

  // The values just written are the ones to publish — re-reading them invited
  // a second writer to change the answer in between.
  await Promise.all(
    counts.map(({ user, unread_count }) =>
      publishNotification(user.toString(), conversationId, {
        unread_count,
        seen: unread_count === 0,
      }),
    ),
  );
};

/**
 * Reading a message is what actually makes it read — the client sends a read
 * receipt for every message that arrives while the conversation is open. Until
 * this existed, only an explicit `PATCH /notifications/seen` (fired on
 * conversation *change*) cleared anything, so the badge climbed on the very
 * chat the user was looking at.
 *
 * Recomputes rather than zeroing: the receipt names the message that was read,
 * and anything that landed after it is still genuinely unread. Blindly writing
 * 0 here is how a counter starts lying.
 */
export const recomputeNotification = async (
  userId: string,
  conversationId: string,
  lastReadMessageId: string,
): Promise<void> => {
  const userObjectId = new Types.ObjectId(userId);
  const conversationObjectId = new Types.ObjectId(conversationId);

  const [lastRead, existing] = await Promise.all([
    Message.findById(new Types.ObjectId(lastReadMessageId))
      .select('timestamp')
      .lean(),
    Notification.findOne({
      user: userObjectId,
      conversation: conversationObjectId,
    })
      .select('seen_at unread_count seen')
      .lean(),
  ]);

  // Nothing was ever recorded for this pair, so there is no badge to correct.
  if (!existing) return;

  const unread_count = await deriveUnreadCount(
    conversationObjectId,
    userObjectId,
    watermarkOf(lastRead?.timestamp, existing.seen_at),
  );

  const seen = unread_count === 0;
  if (existing.unread_count === unread_count && existing.seen === seen) return;

  await Notification.updateOne(
    { user: userObjectId, conversation: conversationObjectId },
    { $set: { unread_count, seen } },
  );

  await publishNotification(userId, conversationId, { unread_count, seen });
};

/**
 * Drops the badge for one conversation without touching seen_at. Muting is not
 * reading: the watermark has to stay where it is so unmuting can bring back
 * whatever accumulated in the meantime.
 */
export const clearNotificationForMute = async (
  userId: string,
  conversationId: string,
): Promise<void> => {
  await Notification.updateOne(
    {
      user: new Types.ObjectId(userId),
      conversation: new Types.ObjectId(conversationId),
    },
    { $set: { unread_count: 0, seen: true } },
  );

  // The client holds its list in memory; without a push the badge would sit
  // there until the next load.
  await publishNotification(userId, conversationId, {
    unread_count: 0,
    seen: true,
  });
};

/**
 * Recomputes one pair from what is already persisted, with no read receipt in
 * hand. Used when the count changes for a reason other than a message or a
 * read — unmuting, where the messages that arrived while muted become visible
 * again all at once.
 */
export const refreshNotificationForConversation = async (
  userId: string,
  conversationId: string,
): Promise<void> => {
  const userObjectId = new Types.ObjectId(userId);
  const conversationObjectId = new Types.ObjectId(conversationId);

  const [conversation, existing] = await Promise.all([
    Conversation.findById(conversationObjectId)
      .select('read_receipts participants')
      .lean(),
    Notification.findOne({
      user: userObjectId,
      conversation: conversationObjectId,
    })
      .select('seen_at')
      .lean(),
  ]);

  if (!conversation || !existing) return;
  if (!conversation.participants.some((p) => p.toString() === userId)) return;

  const timestampById = await timestampsByMessageId(
    conversation.read_receipts ?? [],
  );

  const unread_count = await deriveUnreadCount(
    conversationObjectId,
    userObjectId,
    watermarkOf(
      receiptTimestampFor(conversation.read_receipts, userId, timestampById),
      existing.seen_at,
    ),
  );

  const seen = unread_count === 0;

  await Notification.updateOne(
    { user: userObjectId, conversation: conversationObjectId },
    { $set: { unread_count, seen } },
  );

  await publishNotification(userId, conversationId, { unread_count, seen });
};

/**
 * A user added to an existing conversation has not missed its history — they
 * were not there for it. Without a watermark at join time the derived count has
 * nothing to bound it and reports every message ever sent as unread.
 */
export const seedNotificationWatermarks = async (
  conversationId: Types.ObjectId,
  userIds: Types.ObjectId[],
): Promise<void> => {
  if (userIds.length === 0) return;

  const joinedAt = new Date();

  await Notification.bulkWrite(
    userIds.map((user) => ({
      updateOne: {
        filter: { user, conversation: conversationId },
        update: {
          $set: { seen_at: joinedAt, unread_count: 0, seen: true },
        },
        upsert: true,
      },
    })),
  );
};

/**
 * Conversations this user has muted. Used to leave their rows alone rather than
 * to delete them: unmuting has to be able to bring the badge back.
 */
const mutedConversationIds = async (
  userId: Types.ObjectId,
  conversationIds: Types.ObjectId[],
): Promise<Set<string>> => {
  const muted = await MutedConversation.find({
    user: userId,
    conversation: { $in: conversationIds },
  })
    .select('conversation')
    .lean();

  return new Set(muted.map((m) => m.conversation.toString()));
};

/**
 * Rows for conversations the user is no longer part of, or that no longer
 * exist. deriveUnreadCount filters by conversation alone, so a row left behind
 * by a removal keeps counting messages the user can no longer read — the badge
 * on a group they were kicked out of climbs forever, and the conversation is
 * still populated back to them on load.
 */
export const dropOrphanedNotifications = async (
  userId: Types.ObjectId,
  conversations: Types.ObjectId[],
): Promise<void> => {
  if (conversations.length === 0) return;

  await Notification.deleteMany({ user: userId, conversation: { $in: conversations } });
};

/**
 * Every notification row belonging to a conversation, for the given users or
 * for all of them. Called when membership ends, so the counter does not outlive
 * the access it describes.
 */
export const dropNotificationsForConversation = async (
  conversationId: Types.ObjectId,
  userIds?: Types.ObjectId[],
): Promise<void> => {
  if (userIds && userIds.length === 0) return;

  await Notification.deleteMany({
    conversation: conversationId,
    ...(userIds ? { user: { $in: userIds } } : {}),
  });
};

/**
 * Recomputes every row for one user and writes back what changed. This is what
 * makes drift temporary: whatever a race left behind is corrected the next time
 * the user loads their notifications.
 *
 * Returns the conversations that should not be badged at all — muted, or gone.
 * The caller serves the list, and a row it cannot see is a row it cannot render
 * a stale count from.
 */
export const refreshNotificationsForUser = async (
  userId: Types.ObjectId,
): Promise<{ muted: Set<string> }> => {
  const notifications = await Notification.find({ user: userId })
    .select('conversation seen_at')
    .lean();

  if (notifications.length === 0) return { muted: new Set() };

  const conversationIds = notifications.map((n) => n.conversation);
  const key = userId.toString();

  const [conversations, muted] = await Promise.all([
    Conversation.find({ _id: { $in: conversationIds } })
      .select('read_receipts participants')
      .lean(),
    mutedConversationIds(userId, conversationIds),
  ]);

  const conversationById = new Map(
    conversations.map((c) => [c._id.toString(), c]),
  );

  const orphaned = notifications
    .filter((notif) => {
      const conversation = conversationById.get(notif.conversation.toString());
      return (
        !conversation ||
        !conversation.participants.some((p) => p.toString() === key)
      );
    })
    .map((notif) => notif.conversation);

  await dropOrphanedNotifications(userId, orphaned);

  const orphanedIds = new Set(orphaned.map((id) => id.toString()));

  // Muted rows are skipped rather than recomputed: nothing is published for
  // them and the caller withholds them, so a count would only be work nobody
  // reads. Leaving the stored value untouched is also what lets unmuting
  // restore the badge on the next refresh.
  const live = notifications.filter((notif) => {
    const id = notif.conversation.toString();
    return !orphanedIds.has(id) && !muted.has(id);
  });

  if (live.length === 0) return { muted };

  const timestampById = await timestampsByMessageId(
    live.flatMap((notif) =>
      (
        conversationById.get(notif.conversation.toString())?.read_receipts ?? []
      ).filter((r) => r.user_id?.toString() === key),
    ),
  );

  const targets = live.map((notif) => ({
    conversation: notif.conversation,
    since: watermarkOf(
      receiptTimestampFor(
        conversationById.get(notif.conversation.toString())?.read_receipts,
        key,
        timestampById,
      ),
      notif.seen_at,
    ),
  }));

  // One aggregation for every conversation. This runs on every GET
  // /notifications, and it used to be a countDocuments per row.
  const unreadByConversation = await deriveUnreadCounts(userId, targets);

  const counts = targets.map(({ conversation }) => ({
    conversation,
    // No group came back for a conversation with nothing unread.
    unread_count: unreadByConversation.get(conversation.toString()) ?? 0,
  }));

  // seen tracks unread_count: the client hides any row flagged seen, so a
  // refreshed count on a still-seen row would be invisible.
  await Notification.bulkWrite(
    counts.map(({ conversation, unread_count }) => ({
      updateOne: {
        filter: { user: userId, conversation },
        update: { $set: { unread_count, seen: unread_count === 0 } },
      },
    })),
  );

  return { muted };
};
