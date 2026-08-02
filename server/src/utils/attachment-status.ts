import { Message } from '../messenger/models/message.model';
import { IAttachment } from '../messenger/models/message.model';
import { Conversation } from '../messenger/models/conversation.model';
import { emitToUser } from './ws-emit';
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

/**
 * Tell every participant that an attachment will never arrive.
 *
 * The success path notifies the whole conversation (uploader via the processor,
 * everyone else via the side-effect handler), but the infected and failed paths
 * only ever messaged the uploader — so other members were left with a spinner
 * that never resolved for an attachment that was never coming.
 *
 * `except` skips whoever has already been notified directly.
 */
export const notifyAttachmentOutcome = async (
  uploadId: string,
  event: Record<string, unknown>,
  except?: string,
): Promise<void> => {
  try {
    const message = await Message.findOne({
      'attachments.uploadId': uploadId,
    }).select('conversation');
    if (!message) return;

    const conversation = await Conversation.findById(
      message.conversation,
    ).select('participants');

    await Promise.all(
      (conversation?.participants ?? [])
        .map((participant) => participant.toString())
        .filter((participantId) => participantId !== except)
        .map((participantId) => emitToUser(participantId, event)),
    );
  } catch (error) {
    logger.error(
      `Failed to notify participants about attachment ${uploadId}:`,
      error,
    );
  }
};
