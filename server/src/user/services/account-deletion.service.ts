import { Types } from 'mongoose';
import { User } from '../models/user.model';
import { Conversation } from '../../messenger/models/conversation.model';
import { Message } from '../../messenger/models/message.model';
import { MutedConversation } from '../../messenger/models/muted-conversation.model';
import { Notification } from '../../messenger/models/notifications.model';
import { TwoFactorAuthModel } from '../../auth/models/two-factor.model';
import { AccountTokensModel } from '../../auth/models/account-tokens.model';
import { deleteAllUserRefreshTokens } from '../../auth/services/token.service';
import { purgeUploads } from '../../upload/upload-cleanup.service';
import { invalidateParticipantsCache } from '../../utils/conversation-cache';
import { logger } from '../../utils/logger';

/*
 * Deleting an account used to remove exactly one document: the user. Everything
 * else stayed — messages, uploads and their stored objects, notifications,
 * mutes, refresh tokens, the 2FA secret, and every other user's block list
 * still naming them. The account was gone from the login screen and present
 * everywhere else, with conversations populating a null participant where the
 * person used to be.
 */

/**
 * Removes an account and everything that belongs to it.
 *
 * Messages are tombstoned rather than dropped. They are load-bearing: read
 * receipts point at message ids and `last_message` references them, so removing
 * the rows would leave other participants' unread counts with no watermark and
 * mark whole conversations unread. The content and attachments — the part that
 * is actually the user's data — are cleared, which is the same shape a
 * user-initiated delete produces.
 */
export const deleteAccount = async (userId: Types.ObjectId): Promise<void> => {
  const conversations = await Conversation.find({ participants: userId })
    .select('participants is_group created_by')
    .lean();

  const conversationIds = conversations.map((c) => c._id);

  // Stored objects first: once the Upload records are gone there is nothing
  // left that knows which keys belonged to this user.
  await purgeUploads({ userId });

  await Message.updateMany(
    { sender: userId, deleted_at: { $exists: false } },
    { $set: { deleted_at: new Date(), attachments: [] }, $unset: { content: 1 } },
  );

  /*
   * A conversation the departing user leaves behind is only viable if someone
   * is still in it *and* it still has enough members to be what it claims to
   * be. A DM with one party left is not a DM, and a group with nobody in it is
   * nothing at all — both would otherwise sit in the remaining member's list
   * forever, unopenable.
   */
  const doomed: Types.ObjectId[] = [];

  for (const conversation of conversations) {
    const remaining = conversation.participants.filter(
      (p) => !p.equals(userId),
    );

    if (remaining.length < 2) {
      doomed.push(conversation._id);
    }
  }

  if (doomed.length > 0) {
    await Message.deleteMany({ conversation: { $in: doomed } });
    await Conversation.deleteMany({ _id: { $in: doomed } });
  }

  const survivors = conversationIds.filter(
    (id) => !doomed.some((d) => d.equals(id)),
  );

  if (survivors.length > 0) {
    await Conversation.updateMany(
      { _id: { $in: survivors } },
      {
        $pull: {
          participants: userId,
          read_receipts: { user_id: userId },
        },
      },
    );
  }

  // The cached participant list drives every broadcast; it is now wrong for
  // each of these.
  await Promise.all(
    conversationIds.map((id) => invalidateParticipantsCache(id.toString())),
  );

  await Promise.all([
    Notification.deleteMany({ user: userId }),
    MutedConversation.deleteMany({ user: userId }),
    TwoFactorAuthModel.deleteMany({ user_id: userId }),
    AccountTokensModel.deleteMany({ user_id: userId }),
    // A block list naming an account that no longer exists renders as a blank
    // row on the privacy screen and silently filters nobody.
    User.updateMany(
      { blocked_users: userId },
      { $pull: { blocked_users: userId } },
    ),
  ]);

  await deleteAllUserRefreshTokens(userId.toString());

  await User.deleteOne({ _id: userId });

  logger.info(
    `Deleted account ${userId.toString()}: ${conversationIds.length} conversations touched, ${doomed.length} removed`,
  );
};
