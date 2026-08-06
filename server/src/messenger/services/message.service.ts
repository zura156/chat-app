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
 * Refuses the send if the sender and the person they are reaching have blocked
 * each other. Checked here rather than at the route because both entry points —
 * plain text and attachments — have to be covered, and a block that only stops
 * one of them is not a block. INFO messages are exempt: they are the system
 * narrating membership changes, not a user reaching anyone.
 *
 * A block only refuses the send in a one-to-one conversation, where the blocked
 * party *is* the audience. In a group it does not: refusing there let a single
 * member silence the sender for everyone else in the room, which is a block
 * acting on people who never asked for it. Delivery is filtered instead — see
 * `deliverableParticipants`.
 */
const assertNotBlocked = async (
  senderId: string,
  conversationId: string | Types.ObjectId,
): Promise<void> => {
  const conversation = await Conversation.findById(conversationId)
    .select('participants is_group')
    .lean();

  if (!conversation || conversation.is_group) return;

  const blocked = await blockedAmong(senderId, conversation.participants);
  if (blocked.size > 0) {
    throw createCustomError(
      'You can no longer send messages in this conversation',
      403,
    );
  }
};

/**
 * Who in a conversation should actually receive a message from this sender.
 *
 * In a group, a member who has blocked the sender (or whom the sender has
 * blocked) stays in the conversation but stops seeing that sender's messages.
 * That is what a block means between two people who share a room with others.
 */
const deliverableParticipants = async (
  senderId: string,
  conversationId: string | Types.ObjectId,
): Promise<string[] | undefined> => {
  const conversation = await Conversation.findById(conversationId)
    .select('participants is_group')
    .lean();

  if (!conversation?.is_group) return undefined;

  const blocked = await blockedAmong(senderId, conversation.participants);
  if (blocked.size === 0) return undefined;

  return conversation.participants
    .map((p) => p.toString())
    .filter((id) => !blocked.has(id));
};

/** Mirrored by the schema and by the client's own check. */
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_ATTACHMENTS = 10;

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

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw createCustomError(
        `Message content exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters`,
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
    //
    // Everything else describing what the message *was* goes with them. `type`
    // outlived the content it described, and kept narrating it: the
    // conversation list captioned a deleted photo "📷 Photo" indefinitely, and
    // in the thread a deleted video or file was drawn with no bubble while a
    // deleted text got one — so a tombstone still announced which kind of
    // message it stood in for. TEXT is what a tombstone actually is: one line
    // of text. Normalising rather than unsetting keeps every `switch (type)` on
    // both sides of the wire defined over a value it already handles.
    //
    // What survives is only what the thread needs to keep working: `sender`,
    // `conversation`, `timestamp` and `status`. The first three are named by
    // read receipts, unread counts and `last_message` (see the model); status
    // is delivery state, not a description of the content.
    message.content = undefined;
    message.attachments = [];
    message.edited_at = undefined;
    message.type = MessageTypeEnum.TEXT;
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
    // These are refusals the caller can act on, so they carry a status. Thrown
    // as plain Errors they reached the client as "something went wrong on our
    // end", which is both wrong and unactionable.
    if (!content?.trim() && !attachmentPayloads?.length) {
      throw createCustomError('Message must have content or attachments.', 400);
    }

    if (content && content.length > MAX_MESSAGE_LENGTH) {
      throw createCustomError(
        `Message content exceeds ${MAX_MESSAGE_LENGTH} characters.`,
        400,
      );
    }

    if (attachmentPayloads.length > MAX_ATTACHMENTS) {
      throw createCustomError(
        `Maximum ${MAX_ATTACHMENTS} attachments per message.`,
        400,
      );
    }

    await assertNotBlocked(senderId, conversationId);

    // verify all uploads exist and belong to sender
    const uploadIds = attachmentPayloads.map((a) => a.uploadId);
    const uploads = await Upload.find({
      _id: { $in: uploadIds },
      userId: senderId,
    });

    if (uploads.length !== uploadIds.length) {
      throw createCustomError(
        'One or more uploads not found or unauthorized.',
        400,
      );
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

    if (!populated) throw createCustomError('Failed to populate message.', 500);

    const signed = await signMessage(populated);
    const broadcastPayload = tempId ? { ...signed, tempId } : signed;

    await this.broadcast(
      broadcastPayload,
      await deliverableParticipants(senderId, conversationId),
    );

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
      throw createCustomError('Message content cannot be empty.', 400);
    }

    if (content.length > MAX_MESSAGE_LENGTH) {
      throw createCustomError(
        `Message content exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters.`,
        400,
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
      throw createCustomError('Failed to create and populate message.', 500);
    }

    const broadcastPayload = tempId
      ? { ...populatedMessage.toObject(), tempId }
      : populatedMessage;

    // Broadcast the new message to relevant clients
    await this.broadcast(
      broadcastPayload,
      (type ?? MessageTypeEnum.TEXT) === MessageTypeEnum.INFO
        ? undefined
        : await deliverableParticipants(senderId, conversationObjectId),
    );

    // system/INFO messages are not something anyone needs a badge for
    if ((type ?? MessageTypeEnum.TEXT) !== MessageTypeEnum.INFO) {
      createNotification(senderId, conversationId).catch((error) =>
        logger.error('Failed to create notification:', error),
      );
    }

    return populatedMessage;
  }
}
