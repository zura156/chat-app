import { Types, QueryFilter } from 'mongoose';
import { IMessage, Message } from '../models/message.model';
import { Conversation } from '../models/conversation.model';
import { BroadcastFunction } from '../../websocket/services/websocket.service';
import { MessageTypeEnum } from '../interfaces/message.interface';
import { Upload } from '../../upload/upload.model';
import { signMessage, signMessages } from '../../upload/media-url.service';
import { createNotification } from './notification.service';
import { logger } from '../../utils/logger';
import { blockedAmong } from '../../user/services/blocking.service';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';

/**
 * Refuses the send if the sender and any recipient have blocked each other.
 * Checked here rather than at the route because both entry points — plain text
 * and attachments — have to be covered, and a block that only stops one of them
 * is not a block. INFO messages are exempt: they are the system narrating
 * membership changes, not a user reaching anyone.
 */
const assertNotBlocked = async (
  senderId: string,
  conversationId: string | Types.ObjectId,
): Promise<void> => {
  const conversation = await Conversation.findById(conversationId)
    .select('participants')
    .lean();

  if (!conversation) return;

  const blocked = await blockedAmong(senderId, conversation.participants);
  if (blocked.size > 0) {
    throw createCustomError(
      'You can no longer send messages in this conversation',
      403,
    );
  }
};

export class MessageService {
  private broadcast: BroadcastFunction;

  // The service is initialized with a broadcast function for real-time updates
  constructor(broadcastFunction: BroadcastFunction) {
    this.broadcast = broadcastFunction;
  }

  /**
   * Fetches a paginated list of messages for a given conversation.
   * This logic was moved from your original controller.
   * @param conversationId The ID of the conversation.
   * @param limit The number of messages to return.
   * @param offset The number of messages to skip.
   * @returns A promise that resolves to the messages and total count.
   */
  public async getMessagesForConversation(
    conversationId: string,
    limit: number,
    offset: number,
  ) {
    const [messages, totalCount] = await Promise.all([
      Message.find({ conversation: conversationId })
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .populate('sender', 'username pfp_url pfp_variants'),
      Message.countDocuments({ conversation: conversationId }),
    ]);
    return { messages: await signMessages(messages), totalCount };
  }

  public async getMediaMessages(
    conversationId: string,
    limit: number,
    offset: number,
  ) {
    const query: QueryFilter<IMessage> = {
      conversation: conversationId,
      'attachments.0': { $exists: true },
      'attachments.context': { $in: ['dm-image', 'dm-video'] },
    };
    const [messages, totalCount] = await Promise.all([
      Message.find(query)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .populate('sender', 'username pfp_url pfp_variants'),
      Message.countDocuments(query),
    ]);
    return { messages: await signMessages(messages), totalCount };
  }

  public async getFileMessages(
    conversationId: string,
    limit: number,
    offset: number,
  ) {
    const query: QueryFilter<IMessage> = {
      conversation: conversationId,
      'attachments.0': { $exists: true },
      'attachments.context': 'dm-file',
    };
    const [messages, totalCount] = await Promise.all([
      Message.find(query)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .populate('sender', 'username pfp_url pfp_variants'),
      Message.countDocuments(query),
    ]);
    return { messages: await signMessages(messages), totalCount };
  }

  /**
   * Loads a message and proves the caller may act on it: it has to exist, be in
   * the conversation the route validated, and belong to the caller. Editing or
   * deleting someone else's message is not a thing, and neither is reaching
   * into another conversation by id.
   */
  private async ownMessage(
    senderId: string,
    conversationId: string,
    messageId: string,
  ) {
    if (!Types.ObjectId.isValid(messageId)) {
      throw createCustomError('Invalid message id', 400);
    }

    const message = await Message.findOne({
      _id: new Types.ObjectId(messageId),
      conversation: new Types.ObjectId(conversationId),
    });

    if (!message) throw createCustomError('Message not found', 404);

    if (message.sender.toString() !== senderId) {
      throw createCustomError('You can only change your own messages', 403);
    }

    if (message.deleted_at) {
      throw createCustomError('This message was deleted', 410);
    }

    if (message.type === MessageTypeEnum.INFO) {
      throw createCustomError('System messages cannot be changed', 400);
    }

    return message;
  }

  public async editMessage(
    senderId: string,
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<IMessage> {
    const trimmed = (content ?? '').trim();

    if (!trimmed) {
      throw createCustomError('Message content cannot be empty', 400);
    }

    if (trimmed.length > 2000) {
      throw createCustomError(
        'Message content exceeds the maximum length of 2000 characters',
        400,
      );
    }

    const message = await this.ownMessage(senderId, conversationId, messageId);

    // Only the text is editable. Swapping the attachments of a message someone
    // has already seen would change what they were shown after the fact.
    message.content = trimmed;
    message.edited_at = new Date();
    await message.save();

    const populated = await Message.findById(message._id).populate(
      'sender',
      'username pfp_url pfp_variants',
    );

    if (!populated) throw createCustomError('Message not found', 404);

    const signed = await signMessage(populated);

    // Not a MessageTypeEnum, so broadcast passes it through rather than
    // wrapping it as a new message the clients would append.
    this.broadcast({
      type: 'message-edited',
      conversation: conversationId,
      message: signed,
    });

    return signed as IMessage;
  }

  public async deleteMessage(
    senderId: string,
    conversationId: string,
    messageId: string,
  ): Promise<{ _id: string; conversation: string; deleted_at: Date }> {
    const message = await this.ownMessage(senderId, conversationId, messageId);

    const deleted_at = new Date();

    // The row stays, emptied: the content and attachments are what the user
    // asked to take back, the message itself is load-bearing for read receipts
    // and for `last_message`.
    message.content = undefined;
    message.attachments = [];
    message.deleted_at = deleted_at;
    await message.save();

    this.broadcast({
      type: 'message-deleted',
      conversation: conversationId,
      message: { _id: String(message._id), deleted_at },
    });

    // A message nobody can read should not be sitting in anyone's badge.
    createNotification(senderId, conversationId).catch((error) =>
      logger.error('Failed to refresh notifications after delete:', error),
    );

    return {
      _id: String(message._id),
      conversation: conversationId,
      deleted_at,
    };
  }

  public async createMessageWithAttachments(
    senderId: string,
    conversationId: string,
    content: string | undefined,
    attachmentPayloads: {
      uploadId: string;
      context: 'dm-image' | 'dm-video' | 'dm-file' | 'dm-audio';
      mimeType: string;
      fileSize: number;
      originalName?: string;
    }[],
    tempId?: string,
  ): Promise<Record<string, any>> {
    if (!content?.trim() && !attachmentPayloads?.length) {
      throw new Error('Message must have content or attachments.');
    }

    if (content && content.length > 2000) {
      throw new Error('Message content exceeds 2000 characters.');
    }

    if (attachmentPayloads.length > 10) {
      throw new Error('Maximum 10 attachments per message.');
    }

    await assertNotBlocked(senderId, conversationId);

    // verify all uploads exist and belong to sender
    const uploadIds = attachmentPayloads.map((a) => a.uploadId);
    const uploads = await Upload.find({
      _id: { $in: uploadIds },
      userId: senderId,
    });

    if (uploads.length !== uploadIds.length) {
      throw new Error('One or more uploads not found or unauthorized.');
    }

    // build attachments from upload records — mimeType/fileSize come from the
    // stored record, never from the request body, which is client controlled
    const attachments = attachmentPayloads.map((a) => {
      const upload = uploads.find((u) => u._id.toString() === a.uploadId)!;
      return {
        uploadId: a.uploadId,
        context: upload.context,
        mimeType: upload.mimeType,
        fileSize: upload.fileSize,
        originalName: a.originalName?.toString().slice(0, 255),
        status: upload.status === 'ready' ? 'ready' : 'processing',
        variants: upload.variants ?? null,
        duration: upload.duration ?? null,
      };
    });

    const message = new Message({
      sender: senderId,
      conversation: new Types.ObjectId(conversationId),
      content: content?.trim() || undefined,

      type:
        attachments.length === 0
          ? MessageTypeEnum.TEXT
          : attachments[0].context === 'dm-image'
            ? MessageTypeEnum.IMAGE
            : attachments[0].context === 'dm-video'
              ? MessageTypeEnum.VIDEO
              : attachments[0].context === 'dm-audio'
                ? MessageTypeEnum.AUDIO
                : MessageTypeEnum.FILE,
      attachments,
    });

    await message.save();

    await Conversation.findByIdAndUpdate(conversationId, {
      last_message: message._id,
    });

    const populated = await Message.findById(message._id).populate(
      'sender',
      'username pfp_url pfp_variants',
    );

    if (!populated) throw new Error('Failed to populate message.');

    const signed = await signMessage(populated);
    const broadcastPayload = tempId ? { ...signed, tempId } : signed;

    this.broadcast(broadcastPayload);

    createNotification(senderId, conversationId).catch((error) =>
      logger.error('Failed to create notification:', error),
    );

    return signed;
  }

  /**
   * Creates and saves a new text message.
   * This is the refactored version of your `saveMessage` function.
   * @param senderId The ID of the message sender.
   * @param conversationId The ID of the conversation.
   * @param content The text content of the message.
   * @returns The newly created and populated message.
   */
  public async createTextMessage(
    senderId: string,
    conversationId: string,
    content: string,
    type?: MessageTypeEnum,
    tempId?: string,
  ): Promise<IMessage> {
    const conversationObjectId = new Types.ObjectId(conversationId);

    if (!content || content.trim() === '') {
      throw new Error('Message content cannot be empty.');
    }

    if (content.length > 2000) {
      throw new Error(
        'Message content exceeds the maximum length of 2000 characters.',
      );
    }

    // INFO is the system describing a membership change to everyone present;
    // it is not one user reaching another, so a block does not silence it.
    if ((type ?? MessageTypeEnum.TEXT) !== MessageTypeEnum.INFO) {
      await assertNotBlocked(senderId, conversationObjectId);
    }

    const message = new Message({
      sender: senderId,
      conversation: conversationObjectId,
      content: content,
      type: type ?? MessageTypeEnum.TEXT,
    });

    await message.save();

    // Update the last_message in the conversation
    await Conversation.findByIdAndUpdate(conversationObjectId, {
      last_message: message._id,
    });

    const populatedMessage = await Message.findById(message._id).populate(
      'sender',
      'username pfp_url pfp_variants',
    );

    if (!populatedMessage) {
      throw new Error('Failed to create and populate message.');
    }

    const broadcastPayload = tempId
      ? { ...populatedMessage.toObject(), tempId }
      : populatedMessage;

    // Broadcast the new message to relevant clients
    this.broadcast(broadcastPayload);

    // system/INFO messages are not something anyone needs a badge for
    if ((type ?? MessageTypeEnum.TEXT) !== MessageTypeEnum.INFO) {
      createNotification(senderId, conversationId).catch((error) =>
        logger.error('Failed to create notification:', error),
      );
    }

    return populatedMessage;
  }
}
