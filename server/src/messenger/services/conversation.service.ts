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
import appConfig from '../../config/config';
import { purgeConversationUploads } from '../../upload/upload-cleanup.service';
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

/**
 * Conversation search was unbounded — every match, fully populated, in one
 * response. A user in many conversations searching for a common substring could
 * pull their entire history in a single request.
 */
const SEARCH_RESULT_LIMIT = 50;

/**
 * Whether a URL points at media this server stored. Client-supplied image URLs
 * are otherwise a way to render arbitrary remote content — and to have every
 * viewer's browser make a request to a host of the sender's choosing.
 */
const isOwnMediaUrl = (value: unknown): value is string =>
  typeof value === 'string' &&
  (value.startsWith(`${appConfig.s3Url}/`) || value.startsWith('/'));

/**
 * How `last_message` is loaded for a conversation card, in one place.
 *
 * Every copy of this selected a `file` field that stopped existing when
 * attachments became an array — so a conversation whose newest message was an
 * image or a document rendered with a blank preview in the list. One of the
 * five copies had already been corrected, which is exactly how the other four
 * went unnoticed.
 */
const LAST_MESSAGE_POPULATE = {
  path: 'last_message',
  select: 'content sender timestamp type attachments deleted_at',
  populate: { path: 'sender', select: 'username pfp_url pfp_variants' },
} as const;

/**
 * Who may reshape a group.
 *
 * There was no answer to this before: `validateConversation` proves membership
 * and nothing checked anything further, so any member could remove every other
 * member — including the creator — or delete the conversation and its entire
 * history for everyone. The creator is the group's admin; everyone else may act
 * on themselves and nothing more.
 *
 * DMs have no creator and two equal parties, so they are excluded here and
 * handled by their own rules at each call site.
 */
const isGroupAdmin = (
  conversation: IConversation,
  userId: string,
): boolean => conversation.created_by?.toString() === userId;

const assertGroupAdmin = (
  conversation: IConversation,
  userId: string,
): void => {
  if (!isGroupAdmin(conversation, userId)) {
    throw createCustomError(
      'Only the person who created this conversation can do that',
      403,
    );
  }
};

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
        .populate(LAST_MESSAGE_POPULATE),
      Conversation.countDocuments({ participants: userId }),
    ]);
    return { conversations, totalCount };
  }

  /**
   * Searches for conversations based on a query string.
   */
  public async searchConversations(userId: string, query: string) {
    const userObjectId = new Types.ObjectId(userId);

    // Truncate first, then escape. Escaping first and slicing after could cut
    // through a backslash the escaping had just inserted, leaving a trailing
    // `\` — an invalid regex, which Mongo rejects and the caller sees as a 500.
    const safeQuery = escapeRegex((query ?? '').trim().slice(0, 100));

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
      .populate(LAST_MESSAGE_POPULATE)
      .sort({ updatedAt: -1 })
      .limit(SEARCH_RESULT_LIMIT);

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

    /*
     * `group_name` was capped on update but not on create, and `group_picture`
     * was never checked at all — an arbitrary client string written straight to
     * the document and later rendered as an image source. Only keys this
     * server's own upload pipeline produced are accepted.
     */
    const name = typeof group_name === 'string' ? group_name.trim().slice(0, 100) : undefined;

    if (group_picture !== undefined && !isOwnMediaUrl(group_picture)) {
      throw createCustomError('Invalid group picture', 400);
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
        group_name: name,
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

    // This destroys every message for every member. In a group that is the
    // admin's call alone — any member could previously wipe the whole thread.
    // A member who simply wants out leaves instead (manageConversationMembers
    // with themselves in `remove`).
    if (conversation.is_group) {
      assertGroupAdmin(conversation, userId);
    }

    const conversationId = conversation._id.toString();

    const leaveMessage: ConversationLeaveMessage = {
      type: 'conversation-leave',
      conversation: conversation.toObject(),
      removed_users: conversation.participants.map((p) => p.toString()),
      removed_by: userId,
    };
    await this.broadcast(leaveMessage);

    // Stored objects before the messages that reference them: once the messages
    // are gone nothing knows which uploads belonged to this conversation, and
    // the bytes stay in the bucket for good.
    await purgeConversationUploads(conversation._id as Types.ObjectId);

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
    const removeSet = new Set((memberChanges.remove ?? []).map(String));
    const addSet = new Set((memberChanges.add ?? []).map(String));

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

    /*
     * Two permitted shapes, and nothing in between:
     *
     *   - the admin adding or removing anyone, or
     *   - any member removing exactly themselves, which is "leave".
     *
     * Without this any participant could kick every other participant, the
     * creator included. Leaving is carved out explicitly because refusing it
     * would trap members in a group they cannot exit — the only other way out
     * being to delete the conversation for everybody.
     */
    const isLeaving =
      addSet.size === 0 && removeSet.size === 1 && removeSet.has(userId);

    if (!isLeaving) {
      assertGroupAdmin(conversation, userId);
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

    /*
     * Everything below the save is a consequence of it, so nothing above the
     * save may be observable. The leave event used to be broadcast — and its
     * INFO message written — *before* `conversation.save()`, so a failed write
     * left every client believing in a membership change that never happened.
     */
    await conversation.save();
    // Membership changed — the cached participant list used by broadcast() is
    // now wrong for both the removed and the added users.
    await invalidateParticipantsCache(conversation._id.toString());

    /*
     * Captured *before* the populate below, while `participants` still holds
     * ObjectIds.
     *
     * `populate()` replaces the array in place with full documents, and
     * `Document.prototype.toString()` is `util.inspect` output — so reading the
     * ids off it afterwards produced strings like
     * "{ username: 'x', _id: new ObjectId('...') }". Those went straight into
     * the recipient list of the leave broadcast, which meant the members who
     * *stayed* were never told anyone had left: only the removed users (whose
     * ids came from `removeSet` and were real) received the event.
     */
    const remainingParticipantIds = conversation.participants.map((p) =>
      String((p as { _id?: unknown })?._id ?? p),
    );

    let populatedConversation = (await conversation.populate([
      {
        path: 'participants',
        select: 'first_name last_name username pfp_url pfp_variants',
      },
      LAST_MESSAGE_POPULATE,
    ])) as ConversationI;

    let message: ConversationLeaveMessage | ConversationJoinMessage | undefined;

    const participants =
      populatedConversation.participants as Partial<UserDTO>[];
    /*
     * The actor, as a user object.
     *
     * The remaining participants are the obvious place to look — except when
     * the actor is *leaving*, in which case they were filtered out of the array
     * a few lines above and are only findable among the removed users. Looking
     * solely at the participants is why a member leaving a group produced
     * "A member left the conversation" instead of their username, and sent
     * `removed_by` as a bare id string rather than a user.
     */
    const currentUser =
      participants.find((p) => p._id?.toString() === userId) ??
      (removedUserDocs.find(
        (u) => u._id?.toString() === userId,
      ) as Partial<UserDTO> | undefined);

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
        content: isLeaving
          ? `${currentUser?.username ?? 'A member'} left the conversation`
          : `${removedUsers
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

      // Recipients are named explicitly: the removed users are no longer
      // members, so resolving from the conversation would skip the very people
      // being told they were removed.
      await this.broadcast(message, [
        ...remainingParticipantIds,
        ...removeSet,
      ]);
    }

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
      LAST_MESSAGE_POPULATE,
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
