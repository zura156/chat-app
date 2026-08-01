import { Message } from '../messenger/models/message.model';
import { IAttachment } from '../messenger/models/message.model';
import { logger } from './logger';

/**
 * Reflect a terminal upload outcome on the message attachment that references
 * it. Without this the client keeps showing a "processing" placeholder forever.
 */
export const markAttachmentStatus = async (
  uploadId: string,
  status: IAttachment['status'],
): Promise<void> => {
  try {
    await Message.updateOne(
      { 'attachments.uploadId': uploadId },
      { $set: { 'attachments.$.status': status } },
    );
  } catch (error) {
    logger.error(
      `Failed to mark attachment ${uploadId} as ${status}:`,
      error,
    );
  }
};
