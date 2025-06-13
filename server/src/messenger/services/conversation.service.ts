import { Types } from 'mongoose';
import { Conversation } from '../models/conversation.model';
import { MutedConversation } from '../models/muted-conversation.model';
import { User } from '../../user/models/user.model';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';

export class ConversationService {
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

  /**
   * Fetches a single conversation by its ID, ensuring the user is a participant.
   */
  public async getConversationById(conversationId: string, userId: string) {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    }).populate(
      'participants',
      'first_name last_name username profile_picture status last_seen'
    );

    if (!conversation) {
      throw createCustomError(
        'Conversation not found or you are not a participant',
        404
      );
    }

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

    const conversation = await Conversation.create({
      participants,
      is_group,
      group_name,
      group_picture,
    });
    return Conversation.findById(conversation._id).populate(
      'participants',
      'first_name last_name username profile_picture'
    );
  }

  /**
   * Updates a conversation's details.
   */
  public async updateConversation(
    conversationId: string,
    updateData: { group_name?: string; group_picture?: string }
  ) {
    const updatedConversation = await Conversation.findByIdAndUpdate(
      conversationId,
      updateData,
      { new: true }
    );
    if (!updatedConversation) {
      throw createCustomError('Conversation not found', 404);
    }
    return updatedConversation;
  }

  /**
   * Deletes a conversation after verifying the user is a participant.
   */
  public async deleteConversation(conversationId: string, userId: string) {
    const conversation = await Conversation.findById(conversationId);
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
    await Conversation.findByIdAndDelete(conversationId);
    // You might also want to delete all messages associated with this conversation here
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
}
