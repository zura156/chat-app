import { User } from '../../user/models/user.model';
import { Conversation } from '../../messenger/models/conversation.model';
import { Message } from '../../messenger/models/message.model';
import { JobPayload, ProcessResult } from './types';

export const onAvatarComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  await User.findByIdAndUpdate(payload.userId, {
    profile_picture: result.variants.medium,
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
  await Message.findOneAndUpdate(
    { 'attachments.uploadId': payload.uploadId },
    {
      $set: {
        'attachments.$.status': 'ready',
        'attachments.$.variants': result.variants,
      },
    },
  );
};

export const onPostMediaComplete = async (
  payload: JobPayload,
  result: ProcessResult,
) => {
  // update post media status — implement when posts are built
};
