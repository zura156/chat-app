import { Types, QueryFilter } from 'mongoose';
import { IMessage, Message } from '../models/message.model';
import { Conversation } from '../models/conversation.model';
import { BroadcastFunction } from '../../websocket/services/websocket.service';
import { MessageTypeEnum } from '../interfaces/message.interface';
import { Upload } from '../../upload/upload.model';
import { signMessage, signMessages } from '../../upload/media-url.service';
import { createNotification } from './notification.service';
import { logger } from '../../utils/logger';

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
