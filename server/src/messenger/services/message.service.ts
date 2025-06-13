import { Types } from 'mongoose';
import { IMessage, Message } from '../models/message.model';
import { Conversation } from '../models/conversation.model';
import { BroadcastFunction } from '../../websocket/services/websocket.service';
import {
  MessageTypeEnum,
  getMessageTypeFromMime,
} from '../interfaces/message.interface';

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
    offset: number
  ) {
    const [messages, totalCount] = await Promise.all([
      Message.find({ conversation: conversationId })
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .populate('sender', 'username profile_picture'), // Preserved your populate logic

      Message.countDocuments({ conversation: conversationId }),
    ]);
    return { messages, totalCount };
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
    content: string
  ): Promise<IMessage> {
    const conversationObjectId = new Types.ObjectId(conversationId);

    const message = new Message({
      sender: senderId,
      conversation: conversationObjectId,
      content: content,
      type: MessageTypeEnum.TEXT,
    });

    await message.save();

    // Update the last_message in the conversation
    await Conversation.findByIdAndUpdate(conversationObjectId, {
      last_message: message._id,
    });

    const populatedMessage = await Message.findById(message._id).populate(
      'sender',
      'username profile_picture'
    );

    if (!populatedMessage) {
      throw new Error('Failed to create and populate message.');
    }

    // Broadcast the new message to relevant clients
    this.broadcast(populatedMessage);

    return populatedMessage;
  }

  /**
   * Creates and saves a new file-based message.
   * This is the new functionality.
   * @param file The uploaded file object from Multer.
   * @param senderId The ID of the message sender.
   * @param conversationId The ID of the conversation.
   * @returns The newly created and populated message.
   */
  public async createFileMessage(
    file: Express.Multer.File,
    senderId: string,
    conversationId: string
  ): Promise<IMessage> {
    const conversationObjectId = new Types.ObjectId(conversationId);

    const messageType = getMessageTypeFromMime(file.mimetype);

    const message = new Message({
      sender: senderId,
      conversation: conversationObjectId,
      type: messageType,
      file: {
        url: `/uploads/${file.filename}`,
        name: file.originalname,
        mime_type: file.mimetype,
        size_in_bytes: file.size,
      },
      // 'content' can be a brief description like "Sent a photo"
      content: `${
        messageType.charAt(0).toUpperCase() + messageType.slice(1)
      } Attachment`,
    });

    await message.save();

    // Also update the last_message in the conversation for file messages
    await Conversation.findByIdAndUpdate(conversationObjectId, {
      last_message: message._id,
    });

    const populatedMessage = await Message.findById(message._id).populate(
      'sender',
      'username profile_picture'
    );

    if (!populatedMessage) {
      throw new Error('Failed to create and populate file message.');
    }

    // Broadcast the new file message to relevant clients
    this.broadcast(populatedMessage);

    return populatedMessage;
  }
}
