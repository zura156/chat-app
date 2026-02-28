import { Types } from 'mongoose';
import { Conversation, IConversation } from '../models/conversation.model';
import { MutedConversation } from '../models/muted-conversation.model';
import { IUser, User } from '../../user/models/user.model';
import {
  createCustomError,
  CustomAPIError,
} from '../../error-handling/models/custom-api-error.model';
import { MemberChangesI } from '../interfaces/member-changes.interface';
import { Message } from '../models/message.model';
import { BroadcastFunction } from '../../websocket/services/websocket.service';
import {
  ConversationJoinMessage,
  ConversationLeaveMessage,
  ConversationUpdateMessage,
} from '../../websocket/dtos/websocket.dto';
import { UserInterface } from '../../user/interfaces/user.interface';
import { ConversationI } from '../interfaces/conversation.interface';
import { MessageTypeEnum } from '../interfaces/message.interface';
import { MessageService } from './message.service';
import { error } from 'console';
import { compressMedia } from '../../utils/downscale-media';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../utils/s3';
import config from '../../config/config';
export class ConversationService {
  private broadcast: BroadcastFunction;
  private messageService: MessageService;

  constructor(
    broadcastFunction: BroadcastFunction,
    messageService: MessageService
  ) {
    this.broadcast = broadcastFunction;
    this.messageService = messageService;
  }

  /**
   * Fetches a paginated list of conversations for a user.
   */
  public async getConversations(userId: string, limit: number, offset: number) {
    const [conversations, totalCount] = await Promise.all([
      Conversation.find({ participants: userId })
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .populate('participants', 'username profile_picture')
        .populate({
          path: 'last_message',
          select: 'content sender timestamp type file', // Include file/type for display
          populate: { path: 'sender', select: 'username profile_picture' },
        }),
      Conversation.countDocuments({ participants: userId }),
    ]);
    return { conversations, totalCount };
  }

  /**
   * Searches for conversations based on a query string.
   */
  public async searchConversations(userId: string, query: string) {
    const userObjectId = new Types.ObjectId(userId);
    // Find users matching the query to search their conversations
    const otherUserIds = await User.find({
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { first_name: { $regex: query, $options: 'i' } },
        { last_name: { $regex: query, $options: 'i' } },
      ],
      _id: { $ne: userObjectId },
    }).distinct('_id');

    const conversations = await Conversation.find({
      participants: userObjectId,
      $or: [
        { group_name: { $regex: query, $options: 'i' } },
        { participants: { $in: otherUserIds } },
      ],
    })
      .populate('participants', 'username profile_picture')
      .populate({
        path: 'last_message',
        select: 'content sender timestamp type file',
        populate: { path: 'sender', select: 'username profile_picture' },
      })
      .sort({ updatedAt: -1 });

    return conversations;
  }

  public async findConversationIdByUserId(
    userId: string,
    participantId: string
  ) {
    const userObjectId = new Object(userId);
    const participantObjectId = new Object(participantId);

    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(participantId)
    ) {
      throw createCustomError('Invalid user ID(s)', 400);
    }

    const conversation = await Conversation.findOne({
      participants: { $all: [userObjectId, participantObjectId] },
      $expr: { $eq: [{ $size: '$participants' }, 2] }, // ensures exactly two participants
    });

    if (!conversation) {
      throw createCustomError('Conversation not found!', 404);
    }

    return conversation;
  }

  /**
   * Fetches a single conversation by its ID, ensuring the user is a participant.
   */
  public async getConversationById(
    conversation: IConversation,
    userId: string
  ) {
    conversation.populate(
      'participants',
      'first_name last_name username profile_picture status last_seen'
    );

    // Logic to filter the current user from the participants list for the client
    const otherParticipants = conversation.participants.filter(
      (p: any) => p._id.toString() !== userId.toString()
    );

    return { ...conversation.toObject(), participants: otherParticipants };
  }

  /**
   * Creates a new conversation.
   */
  public async createConversation(
    participants: string[],
    is_group: boolean,
    created_by: string,
    group_name?: string,
    group_picture?: string
  ) {
    // Business logic: Prevent duplicate 1-on-1 conversations
    if (!is_group && participants.length === 2) {
      const existing = await Conversation.findOne({
        participants: { $all: participants, $size: 2 },
        is_group: false,
      });
      if (existing) {
        throw createCustomError(
          'A conversation with these users already exists',
          409
        );
      }
    }

    let conversation = await Conversation.create({
      participants,
      is_group,
      group_name,
      group_picture,
      created_by,
    });

    if (!conversation) {
      throw createCustomError('Failed to create conversation', 500);
    }

    const populatedConversation = (await conversation.populate(
      'participants created_by',
      'first_name last_name username profile_picture'
    )) as ConversationI;

    if (!populatedConversation || !populatedConversation._id) {
      throw createCustomError('Failed to populate conversation', 500);
    }

    const message: ConversationJoinMessage = {
      type: 'conversation-join',
      conversation: populatedConversation,
      added_by: populatedConversation.created_by as UserInterface,
    };

    this.broadcast(message);

    return conversation;
  }

  /**
   * Updates a conversation's details.
   */
  public async updateConversation(
    conversation: IConversation,
    currentUser: IUser,
    group_name?: string,
    group_picture?: Express.Multer.File
  ): Promise<IConversation> {
    let group_picture_url: string | undefined;

    if (
      group_picture &&
      group_picture.mimetype !== 'image/jpeg' &&
      group_picture.mimetype !== 'image/png' &&
      group_picture.mimetype !== 'image/webp'
    ) {
      throw error(
        'Unsupported file format. Only JPEG, PNG, and WEBP are allowed.',
        400
      );
    }

    if (group_picture) {
      const compressedBuffer = await compressMedia(
        group_picture.buffer,
        group_picture.mimetype,
        {
          maxDimension: 500,
          quality: 80,
          outputFormat: 'webp',
        }
      );

      const fileKey = `${Date.now()}-${currentUser.id}.webp`;

      // Upload directly to R2
      await s3.send(
        new PutObjectCommand({
          Bucket: config.s3SharedBucket,
          Key: fileKey,
          Body: compressedBuffer,
          ContentType: 'image/webp',
        })
      );

      // Generate public URL (configure R2 custom domain or public bucket)
      group_picture_url = `${config.s3Url}/${fileKey}`;
    }

    const updateData: Partial<IConversation> = {};

    if (
      arguments.length >= 2 &&
      (typeof group_name === 'string' || group_name === null)
    ) {
      updateData.group_name = group_name;
    }

    if (group_picture_url) {
      updateData.group_picture = group_picture_url;
    }

    Object.assign(conversation, updateData);
    await conversation.save();
    const populatedConversation = (await conversation.populate(
      'participants created_by',
      'first_name last_name username profile_picture status last_seen'
    )) as ConversationI;

    let infoMessage = {
      sender: currentUser.id,
      conversation: conversation.id,
      content: `Conversation was updated by ${currentUser.username}.`,
      type: MessageTypeEnum.INFO,
    };

    if (group_picture_url) {
      infoMessage.content = `${currentUser.username} updated group picture.`;
      await this.messageService.createTextMessage(
        infoMessage.sender,
        infoMessage.conversation,
        infoMessage.content,
        infoMessage.type
      );
    }
    if (group_name) {
      infoMessage.content = `${currentUser.username} ${
        populatedConversation.group_name
          ? 'changed conversation name to ' + populatedConversation.group_name
          : 'cleared the conversation name.'
      }.`;
      await this.messageService.createTextMessage(
        infoMessage.sender,
        infoMessage.conversation,
        infoMessage.content,
        infoMessage.type
      );
    }

    if (!group_name && !group_picture_url)
      await this.messageService.createTextMessage(
        infoMessage.sender,
        infoMessage.conversation,
        infoMessage.content,
        infoMessage.type
      );

    const message: ConversationUpdateMessage = {
      type: 'conversation-update',
      conversation: conversation.toObject(),
    };
    this.broadcast(message);

    return conversation;
  }

  /**
   * Deletes a conversation after verifying the user is a participant.
   */
  public async deleteConversation(conversation: IConversation, userId: string) {
    if (!conversation) {
      throw createCustomError('Conversation not found', 404);
    }
    // Business logic: Ensure user is authorized to delete
    if (!conversation.participants.map((p) => p.toString()).includes(userId)) {
      throw createCustomError(
        'You are not authorized to delete this conversation',
        403
      );
    }
    await conversation.deleteOne();
    // await Conversation.findByIdAndDelete(conversation._id);
    // Delete all messages associated with this conversation here
    await Message.deleteMany({ conversation: conversation._id });
  }

  /**
   * Mutes a conversation for a user.
   */
  public async muteConversation(conversationId: string, userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const conversationObjectId = new Types.ObjectId(conversationId);
    const isMuted = await MutedConversation.findOne({
      user: userObjectId,
      conversation: conversationObjectId,
    });
    if (isMuted) {
      throw createCustomError('Conversation is already muted', 400);
    }
    await MutedConversation.create({
      user: userObjectId,
      conversation: conversationObjectId,
    });
  }

  /**
   * Unmutes a conversation for a user.
   */
  public async unmuteConversation(conversationId: string, userId: string) {
    const result = await MutedConversation.findOneAndDelete({
      user: new Types.ObjectId(userId),
      conversation: new Types.ObjectId(conversationId),
    });
    if (!result) {
      throw createCustomError('Conversation was not muted to begin with', 404);
    }
  }

  public async manageConversationMembers(
    conversation: IConversation,
    userId: string,
    memberChanges: MemberChangesI
  ): Promise<IConversation> {
    const removeSet = new Set(memberChanges.remove);
    const addSet = new Set(memberChanges.add);

    const removedUserDocs = await User.find({
      _id: { $in: Array.from(removeSet) },
    })
      .select('first_name last_name username profile_picture')
      .lean();

    conversation.participants = conversation.participants.filter(
      (participant) => !removeSet.has(participant.toString())
    );

    const currentParticipantIds = new Set(
      conversation.participants.map((id) => id.toString())
    );

    for (const id of addSet) {
      if (!currentParticipantIds.has(id)) {
        conversation.participants.push(new Types.ObjectId(id));
      }
    }

    let populatedConversation = (await conversation.populate([
      {
        path: 'participants',
        select: 'first_name last_name username profile_picture',
      },
      {
        path: 'last_message',
        select: 'content sender timestamp type file',
        populate: { path: 'sender', select: 'username profile_picture' },
      },
    ])) as ConversationI;

    let message: ConversationLeaveMessage | ConversationJoinMessage | undefined;

    const participants =
      populatedConversation.participants as Partial<UserInterface>[];
    const currentUser = participants.find((p) => p._id?.toString() === userId);

    if (removeSet.size > 0) {
      const removedUsers = removedUserDocs;

      message = {
        type: 'conversation-leave',
        conversation: populatedConversation,
        removed_users: Array.from(removeSet),
        removed_by: currentUser || userId,
      };

      const infoMessage = {
        sender: currentUser?._id || userId,
        conversation: String(populatedConversation._id),
        content: `${removedUsers
          .map((p) => p.username)
          .join(', ')} have been removed from the conversation by ${
          currentUser?.username || 'an admin'
        }`,
        type: MessageTypeEnum.INFO,
      };

      await this.messageService.createTextMessage(
        infoMessage.sender,
        infoMessage.conversation,
        infoMessage.content,
        infoMessage.type
      );

      this.broadcast(message);
    }

    await conversation.save();
    populatedConversation = (await conversation.populate([
      {
        path: 'participants',
        select: 'first_name last_name username profile_picture',
      },
      {
        path: 'last_message',
        select: 'content sender timestamp type file',
        populate: { path: 'sender', select: 'username profile_picture' },
      },
    ])) as ConversationI;

    if (addSet.size > 0) {
      message = {
        type: 'conversation-join',
        conversation: populatedConversation,
        added_users: Array.from(addSet),
        added_by: currentUser || userId,
      };
      const infoMessage = {
        sender: currentUser?._id || userId,
        conversation: String(populatedConversation._id),
        content: `${(message.conversation.participants as UserInterface[])
          .filter((p) => addSet.has(p._id.toString()))
          .map((p) => p.username)
          .join(', ')} have been added to the conversation by ${
          currentUser?.username || 'an admin'
        }`,
        type: MessageTypeEnum.INFO,
      };

      await this.messageService.createTextMessage(
        infoMessage.sender,
        infoMessage.conversation,
        infoMessage.content,
        infoMessage.type
      );

      this.broadcast(message);
    }

    // Logic to filter the current user from the participants list for the client
    const otherParticipants = conversation.participants.filter(
      (p: any) => p._id.toString() !== userId.toString()
    );
    return { ...conversation.toObject(), participants: otherParticipants };
  }
}
function next(arg0: CustomAPIError) {
  throw new Error('Function not implemented.');
}
