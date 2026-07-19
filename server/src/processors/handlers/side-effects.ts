import { User } from '../../user/models/user.model';
import { Conversation } from '../../messenger/models/conversation.model';
import { Message } from '../../messenger/models/message.model';
import { JobPayload, ProcessResult } from './types';
import { emitToUser } from '../../utils/ws-emit';

export const onAvatarComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  await User.findByIdAndUpdate(payload.userId, {
    pfp_url: result.variants.medium,
  });
};

export const onGroupAvatarComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  await Conversation.findByIdAndUpdate(payload.resourceId, {
    group_picture: result.variants.medium,
  });
};

export const onCoverPhotoComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  await User.findByIdAndUpdate(payload.userId, {
    cover_url: result.variants.large,
  });
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
    variants: result.variants,
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
