import type { Types } from 'mongoose';
import { User } from '../../user/models/user.model';
import { Conversation } from '../../messenger/models/conversation.model';
import { Message } from '../../messenger/models/message.model';
import { MessageTypeEnum } from '../../messenger/interfaces/message.interface';
import { JobPayload, ProcessResult } from './types';
import { broadcastToParticipants, emitToUser } from '../../utils/ws-emit';
import { signVariants } from '../../upload/media-url.service';
import { purgeUploads } from '../../upload/upload-cleanup.service';
import { logger } from '../../utils/logger';

/**
 * Drops the upload this one replaces, objects and record together.
 *
 * Avatars, cover photos and group pictures are single-slot: one is current and
 * the rest are superseded the moment a new one is ready. Nothing removed them,
 * so every change left three more objects in the bucket permanently — and
 * because the storage screen sums `Upload` records by context, a user who
 * changed their picture ten times was shown ten pictures' worth of "Profile
 * media" they had no way to reclaim.
 *
 * Scoped by whatever owns the slot: the user for their own avatar and cover,
 * the conversation for a group picture. `$ne` on the current upload is what
 * keeps this from deleting the one that just landed.
 *
 * Best-effort. The picture is already live; failing to tidy up behind it must
 * not fail the job and trigger a retry that reprocesses the same image.
 */
const purgeSupersededUploads = async (
  payload: JobPayload,
  scope: Record<string, unknown>,
): Promise<void> => {
  try {
    await purgeUploads({
      ...scope,
      context: payload.context,
      _id: { $ne: payload.uploadId },
    });
  } catch (error) {
    logger.error(
      `Failed to purge uploads superseded by ${payload.uploadId}:`,
      error,
    );
  }
};

/**
 * The three sizes `imageHandler` produces, in the shape the schema declares.
 *
 * Every image context generates thumb (64px), medium (400px) and large
 * (1200px), and every one of them is uploaded and paid for. Storing only one
 * URL orphans the other two in the bucket and leaves the consumer no choice but
 * the size it was given.
 */
const variantSet = (result: ProcessResult) => ({
  thumb: result.variants.thumb,
  medium: result.variants.medium,
  large: result.variants.large,
});

export const onAvatarComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  await User.findByIdAndUpdate(payload.userId, {
    pfp_url: result.variants.medium,
    /*
     * `pfp_variants` is declared on the schema, selected by every populate in
     * the app, exposed on the public user fields and redacted by the privacy
     * service — and nothing ever wrote it. The chatbox reads
     * `sender.pfp_variants.thumb` for the avatar beside each message, so every
     * one of them fell through to the generic placeholder: profile pictures
     * simply never appeared in a conversation, while the 64px thumb that should
     * have been there sat unreferenced in the bucket.
     */
    pfp_variants: variantSet(result),
  });

  await purgeSupersededUploads(payload, { userId: payload.userId });
};

export const onGroupAvatarComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  const conversation = await Conversation.findByIdAndUpdate(
    payload.resourceId,
    {
      group_picture: result.variants.medium,
      /*
       * The whole set, not just the one URL.
       *
       * `group_picture_variants` is declared on the schema, and the resize step
       * has always produced thumb/medium/large — but only `medium` was ever
       * stored, so the other two were written to the bucket and then orphaned.
       * Recording them is what makes it possible to serve a 64px avatar in a
       * list instead of a 400px one.
       */
      group_picture_variants: variantSet(result),
    },
    { returnDocument: 'after' },
  )
    // The same population the REST endpoints use. A conversation-update event
    // replaces the client's whole object, so anything missing here is a field
    // the receiving client *loses* until its next fetch — an under-populated
    // payload is how a group's member list or last message blanks out the
    // moment someone changes the picture.
    .populate(
      'participants',
      'first_name last_name username pfp_url pfp_variants status last_seen',
    )
    .populate({
      path: 'last_message',
      select: 'content sender timestamp type attachments',
      populate: { path: 'sender', select: 'username pfp_url pfp_variants' },
    });

  if (!conversation) return;

  const participantIds = (
    conversation.participants as unknown as { _id: unknown }[]
  ).map((p) => String(p._id));

  /*
   * Record the change in the thread, the way renames and membership changes
   * already are.
   *
   * Without it a group photo changed silently: the avatar was simply different
   * next time you looked, with nothing saying who did it or when. The INFO
   * message is written before the conversation-update below so that event
   * carries it as `last_message` and the conversation list shows the right
   * preview immediately.
   */
  const infoMessage = await createGroupPictureInfoMessage(
    payload.userId,
    conversation._id as Types.ObjectId,
    participantIds,
  );

  // Push the new picture out, otherwise members only see it after a reload
  const event = {
    type: 'conversation-update',
    conversation: {
      ...conversation.toObject(),
      ...(infoMessage ? { last_message: infoMessage } : {}),
    },
  };

  await Promise.all(
    participantIds.map((participantId) => emitToUser(participantId, event)),
  );

  // Scoped to the conversation, not the uploader: a group picture belongs to
  // the group, and the person replacing it is often not the one who set the
  // last.
  await purgeSupersededUploads(payload, { resourceId: payload.resourceId });
};

/**
 * Writes the "changed the group photo" system message and puts it on the wire.
 *
 * `MessageService.createTextMessage` would normally do this, but it broadcasts
 * through the socket server, which only exists in the API process — this runs
 * in the worker. Hence the direct write and the explicit publish.
 *
 * Failure is swallowed on purpose: the picture has already been changed, and
 * losing the note about it must not fail the job and trigger a retry that
 * processes the same image again.
 */
const createGroupPictureInfoMessage = async (
  userId: string,
  conversationId: Types.ObjectId,
  participantIds: string[],
): Promise<Record<string, unknown> | null> => {
  try {
    const actor = await User.findById(userId).select('username').lean();

    const message = await Message.create({
      sender: userId,
      conversation: conversationId,
      content: `${actor?.username ?? 'Someone'} changed the group photo.`,
      type: MessageTypeEnum.INFO,
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      last_message: message._id,
    });

    const populated = await Message.findById(message._id)
      .populate('sender', 'username pfp_url pfp_variants')
      .lean();

    if (!populated) return null;

    // INFO messages go to everyone present — they describe the conversation
    // rather than carry anything between two people — so no blocking filter
    // and no unread badge, matching createTextMessage.
    await broadcastToParticipants(participantIds, {
      type: 'message',
      message: populated,
    });

    return populated as unknown as Record<string, unknown>;
  } catch (error) {
    logger.error('Failed to record the group picture change:', error);
    return null;
  }
};

export const onCoverPhotoComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  await User.findByIdAndUpdate(payload.userId, {
    cover_url: result.variants.large,
    cover_variants: variantSet(result),
  });

  await purgeSupersededUploads(payload, { userId: payload.userId });
};

export const onDmAttachmentComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  // find message that has this uploadId in attachments array and update it
  const updated = await Message.findOneAndUpdate(
    { 'attachments.uploadId': payload.uploadId },
    {
      $set: {
        'attachments.$.status': 'ready',
        'attachments.$.variants': result.variants,
        'attachments.$.duration': result.duration,
      },
    },
    { returnDocument: 'after' },
  );
  if (!updated) return;

  const conversation = await Conversation.findById(updated.conversation).select(
    'participants',
  );
  const event = {
    type: 'upload-ready',
    uploadId: payload.uploadId,
    variants: await signVariants(result.variants),
    duration: result.duration,
  };
  await Promise.all(
    (conversation?.participants ?? [])
      .filter((p) => p.toString() !== payload.userId)
      .map((p) => emitToUser(p.toString(), event)),
  );
};

export const onPostMediaComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  // update post media status — implement when posts are built
};
