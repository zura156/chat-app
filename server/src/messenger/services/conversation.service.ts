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
import { UserDTO } from '../../user/dtos/user.dto';
import { ConversationI } from '../interfaces/conversation.interface';
import { MessageTypeEnum } from '../interfaces/message.interface';
import { MessageService } from './message.service';
import { buildDmKey } from '../models/conversation.model';
import { invalidateParticipantsCache } from '../../utils/conversation-cache';
import {
  clearNotificationForMute,
  dropNotificationsForConversation,
  refreshNotificationForConversation,
  seedNotificationWatermarks,
} from './notification.service';
import {
  blockedAmong,
  isBlockedEitherWay,
} from '../../user/services/blocking.service';

const escapeRegex = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MAX_PARTICIPANTS = 100;

export class ConversationService {
  private broadcast: BroadcastFunction;
  private messageService: MessageService;

  constructor(
    broadcastFunction: BroadcastFunction,
    messageService: MessageService,
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
        .populate('participants', 'username pfp_url pfp_variants')
        .populate({
          path: 'last_message',
          select: 'content sender timestamp type file', // Include file/type for display
          populate: { path: 'sender', select: 'username pfp_url pfp_variants' },
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
    // Escape the user input: unescaped it is both a ReDoS vector and a way to
    // match every document (e.g. ".*")
    const safeQuery = escapeRegex((query ?? '').trim()).slice(0, 100);

    if (!safeQuery) {
      return [];
    }

    // Find users matching the query to search their conversations
    const otherUserIds = await User.find({
      $or: [
        { username: { $regex: safeQuery, $options: 'i' } },
        { first_name: { $regex: safeQuery, $options: 'i' } },
        { last_name: { $regex: safeQuery, $options: 'i' } },
      ],
      _id: { $ne: userObjectId },
    }).distinct('_id');

    const conversations = await Conversation.find({
      participants: userObjectId,
      $or: [
        { group_name: { $regex: safeQuery, $options: 'i' } },
        { participants: { $in: otherUserIds } },
      ],
    })
      .populate('participants', 'username pfp_url pfp_variants')
      .populate({
        path: 'last_message',
        select: 'content sender timestamp type file',
        populate: { path: 'sender', select: 'username pfp_url pfp_variants' },
      })
      .sort({ updatedAt: -1 });

    return conversations;
  }

  public async findConversationIdByUserId(
    userId: string,
    participantId: string,
  ) {
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(participantId)
    ) {
      throw createCustomError('Invalid user ID(s)', 400);
    }

    if (await isBlockedEitherWay(userId, participantId)) {
      throw createCustomError('Conversation not found!', 404);
    }

    const userObjectId = new Types.ObjectId(userId);
    const participantObjectId = new Types.ObjectId(participantId);

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
    userId: string,
  ) {
    await conversation.populate(
      'participants',
      'first_name last_name username pfp_url pfp_variants status last_seen',
    );

    // Logic to filter the current user from the participants list for the client
    const otherParticipants = conversation.participants.filter(
      (p: any) => p._id.toString() !== userId.toString(),
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
    group_picture?: string,
  ) {
    // The creator is always a member, and a member is only listed once
    const participantIds = Array.from(
      new Set([...(participants ?? []), created_by].map(String)),
    );

    if (participantIds.some((id) => !Types.ObjectId.isValid(id))) {
      throw createCustomError('Invalid participant id', 400);
    }

    if (participantIds.length < 2) {
      throw createCustomError('A conversation needs at least 2 members', 400);
    }

    if (participantIds.length > MAX_PARTICIPANTS) {
      throw createCustomError(
        `A conversation can have at most ${MAX_PARTICIPANTS} members`,
        400,
      );
    }

    const knownUsers = await User.countDocuments({
      _id: { $in: participantIds },
    });
    if (knownUsers !== participantIds.length) {
      throw createCustomError('One or more participants do not exist', 400);
    }

    // A block has to stop the conversation being created, not just its
    // messages — otherwise blocking someone still leaves them able to open a
    // thread with you and sit in your list.
    const blocked = await blockedAmong(
      created_by,
      participantIds.filter((id) => id !== String(created_by)),
    );
    if (blocked.size > 0) {
      throw createCustomError(
        'You cannot start a conversation with this user',
        403,
      );
    }

    const isDm = !is_group && participantIds.length === 2;
    const dm_key = isDm ? buildDmKey(participantIds) : undefined;

    // Business logic: Prevent duplicate 1-on-1 conversations
    if (isDm) {
      const existing = await Conversation.findOne({ dm_key });
      if (existing) {
        throw createCustomError(
          'A conversation with these users already exists',
          409,
        );
      }
    }

    let conversation;
    try {
      conversation = await Conversation.create({
        participants: participantIds,
        is_group,
        dm_key,
        group_name,
        group_picture,
        created_by,
      });
    } catch (error: any) {
      if (error?.code === 11000 && isDm) {
        throw createCustomError(
          'A conversation with these users already exists',
          409,
        );
      }
      throw error;
    }

    if (!conversation) {
      throw createCustomError('Failed to create conversation', 500);
    }

    const populatedConversation = (await conversation.populate(
      'participants created_by',
      'first_name last_name username pfp_url pfp_variants',
    )) as ConversationI;

    if (!populatedConversation || !populatedConversation._id) {
      throw createCustomError('Failed to populate conversation', 500);
    }

    const message: ConversationJoinMessage = {
      type: 'conversation-join',
      conversation: populatedConversation,
      added_by: populatedConversation.created_by as UserDTO,
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
  ): Promise<IConversation> {
    if (!conversation.is_group) {
      throw createCustomError('Only group conversations can be renamed', 400);
    }

    if (typeof group_name !== 'string') {
      throw createCustomError('group_name is required', 400);
    }

    const nextName = group_name.trim().slice(0, 100);
    const currentName = conversation.group_name ?? '';

    // Nothing changed — don't save and don't spam the thread with an info message
    if (nextName === currentName) {
      return conversation;
    }

    conversation.group_name = nextName || undefined;
    await conversation.save();

    await this.messageService.createTextMessage(
      currentUser._id.toString(),
      conversation._id.toString(),
      nextName
        ? `${currentUser.username} changed conversation name to ${nextName}.`
        : `${currentUser.username} cleared the conversation name.`,
      MessageTypeEnum.INFO,
    );

    const populated = await conversation.populate([
      {
        path: 'participants',
        select:
          'first_name last_name username pfp_url pfp_variants status last_seen',
      },
      {
        path: 'last_message',
        select: 'content sender timestamp type attachments',
        populate: { path: 'sender', select: 'username pfp_url pfp_variants' },
      },
    ]);

    const message: ConversationUpdateMessage = {
      type: 'conversation-update',
      conversation: populated.toObject(),
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
        403,
      );
    }
    const conversationId = conversation._id.toString();

    const leaveMessage: ConversationLeaveMessage = {
      type: 'conversation-leave',
      conversation: conversation.toObject(),
      removed_users: conversation.participants.map((p) => p.toString()),
      removed_by: userId,
    };
    await this.broadcast(leaveMessage);

    await conversation.deleteOne();
    // Delete all messages associated with this conversation here
    await Message.deleteMany({ conversation: conversation._id });
    // Counters and mutes for a conversation that no longer exists: the former
    // would be populated back to the client as a null conversation, the latter
    // would silently apply to a recycled id.
    await dropNotificationsForConversation(conversation._id);
    await MutedConversation.deleteMany({ conversation: conversation._id });
    await invalidateParticipantsCache(conversationId);
  }

  /**
   * The conversations this user has muted. Ids only — the settings screen
   * already has the conversations themselves and just needs to know which
   * toggles are on.
   */
  public async getMutedConversationIds(userId: string): Promise<string[]> {
    const muted = await MutedConversation.find({
      user: new Types.ObjectId(userId),
    })
      .select('conversation')
      .lean();

    return muted.map((m) => m.conversation.toString());
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

    // A mute with a badge still sitting on the card is not a mute.
    await clearNotificationForMute(userId, conversationId);
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

    // Whatever arrived while muted was never counted. Recompute now rather than
    // leaving the badge blank until the next message.
    await refreshNotificationForConversation(userId, conversationId);
  }

  public async manageConversationMembers(
    conversation: IConversation,
    userId: string,
    memberChanges: MemberChangesI,
  ): Promise<IConversation> {
    const removeSet = new Set(memberChanges.remove ?? []);
    const addSet = new Set(memberChanges.add ?? []);

    // Membership changes only make sense for groups: silently mutating a DM
    // would turn it into a group the other party never agreed to.
    if (!conversation.is_group) {
      throw createCustomError(
        'Members can only be managed on group conversations',
        400,
      );
    }

    if (
      [...removeSet, ...addSet].some(
        (id) => !Types.ObjectId.isValid(String(id)),
      )
    ) {
      throw createCustomError('Invalid member id', 400);
    }

    // Counted against the members that actually change, not against the sizes
    // of the requested sets. The code below ignores removals of people who are
    // not in the conversation and additions of people already in it, so
    // measuring the raw sets let padding `remove` with unrelated ids shrink the
    // projected total without shrinking the real one — and the group past the
    // cap. Additions are counted the same way for symmetry: re-adding an
    // existing member is a no-op and should not be charged against the limit.
    const currentIds = new Set(
      conversation.participants.map((p) => p.toString()),
    );
    const effectiveRemovals = [...removeSet].filter((id) =>
      currentIds.has(String(id)),
    ).length;
    const effectiveAdditions = [...addSet].filter(
      (id) => !currentIds.has(String(id)),
    ).length;

    if (
      conversation.participants.length - effectiveRemovals + effectiveAdditions >
      MAX_PARTICIPANTS
    ) {
      throw createCustomError(
        `A conversation can have at most ${MAX_PARTICIPANTS} members`,
        400,
      );
    }

    // createConversation has always rejected participants who do not exist;
    // this path never did, so any well-formed ObjectId could be pushed into the
    // participant list. That leaves members nothing can resolve: populate
    // returns null for them, they are broadcast to and seeded a notification
    // watermark, and they count against the cap forever.
    if (addSet.size > 0) {
      const addIds = Array.from(addSet).map((id) => String(id));
      const knownUsers = await User.countDocuments({ _id: { $in: addIds } });
      if (knownUsers !== addIds.length) {
        throw createCustomError('One or more members do not exist', 400);
      }

      // You cannot pull someone you have blocked (or who blocked you) into a
      // group, which would route their messages to you anyway.
      const blocked = await blockedAmong(userId, addIds);
      if (blocked.size > 0) {
        throw createCustomError(
          'You cannot add a user you have blocked',
          403,
        );
      }
    }

    const removedUserDocs = await User.find({
      _id: { $in: Array.from(removeSet) },
    })
      .select('first_name last_name username pfp_url pfp_variants')
      .lean();

    conversation.participants = conversation.participants.filter(
      (participant) => !removeSet.has(participant.toString()),
    );

    const currentParticipantIds = new Set(
      conversation.participants.map((id) => id.toString()),
    );

    const addedParticipantIds: Types.ObjectId[] = [];
    for (const id of addSet) {
      if (!currentParticipantIds.has(id)) {
        const objectId = new Types.ObjectId(id);
        conversation.participants.push(objectId);
        addedParticipantIds.push(objectId);
      }
    }

    let populatedConversation = (await conversation.populate([
      {
        path: 'participants',
        select: 'first_name last_name username pfp_url pfp_variants',
      },
      {
        path: 'last_message',
        select: 'content sender timestamp type file',
        populate: { path: 'sender', select: 'username pfp_url pfp_variants' },
      },
    ])) as ConversationI;

    let message: ConversationLeaveMessage | ConversationJoinMessage | undefined;

    const participants =
      populatedConversation.participants as Partial<UserDTO>[];
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
        infoMessage.type,
      );

      this.broadcast(message);
    }

    await conversation.save();
    // Membership changed — the cached participant list used by broadcast() is
    // now wrong for both the removed and the added users.
    await invalidateParticipantsCache(conversation._id.toString());

    // Both of these follow the save rather than precede it: until membership is
    // durable, seeding a watermark or dropping a counter describes a change
    // that may not have happened.

    // A user added to an existing conversation has not missed its history, and
    // this runs before the join's info message so the join is not their first
    // unread either.
    await seedNotificationWatermarks(conversation._id, addedParticipantIds);

    // A removed user keeps no counter for a conversation they can no longer
    // read: the count is derived per conversation, so a row left behind goes on
    // climbing with every message they are no longer sent.
    if (removeSet.size > 0) {
      const removedIds = Array.from(removeSet).map(
        (id) => new Types.ObjectId(String(id)),
      );
      await dropNotificationsForConversation(conversation._id, removedIds);
      await MutedConversation.deleteMany({
        conversation: conversation._id,
        user: { $in: removedIds },
      });
    }

    populatedConversation = (await conversation.populate([
      {
        path: 'participants',
        select: 'first_name last_name username pfp_url pfp_variants',
      },
      {
        path: 'last_message',
        select: 'content sender timestamp type file',
        populate: { path: 'sender', select: 'username pfp_url pfp_variants' },
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
        content: `${(message.conversation.participants as UserDTO[])
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
        infoMessage.type,
      );

      this.broadcast(message);
    }

    // Logic to filter the current user from the participants list for the client
    const otherParticipants = conversation.participants.filter(
      (p: any) => p._id.toString() !== userId.toString(),
    );
    return { ...conversation.toObject(), participants: otherParticipants };
  }
}
