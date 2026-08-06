import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import { WebSocketService } from '../services/websocket.service';
import * as DTO from '../dtos/websocket.dto';
import {
  Conversation,
  upsertReadReceipt,
} from '../../messenger/models/conversation.model';
import type { Types } from 'mongoose';
import { User } from '../../user/models/user.model';
import { Message } from '../../messenger/models/message.model';
import { MessageStatusEnum } from '../../messenger/interfaces/message.interface';
import { ObjectId } from 'mongodb';
import { redisClient } from '../../config/redis';
import { recomputeNotification } from '../../messenger/services/notification.service';
import type { AuthenticatedWebSocket } from '../websocket.setup';
import { broadcastsPresence } from '../../user/services/privacy.service';

/**
 * How long a disconnect waits before it counts as going offline — long enough
 * to ride out a refresh, a tunnel change or a backgrounded tab.
 */
const OFFLINE_DELAY_MS = 30_000;

/**
 * Users whose disconnect is waiting out {@link OFFLINE_DELAY_MS}, scored by
 * when they come due.
 *
 * This used to be a per-user key plus an in-process `setTimeout`, which meant
 * the transition only existed in the memory of the one process that saw the
 * socket close. A redeploy, a crash or a scale-down inside that 30-second
 * window dropped the timer on the floor and the user was left marked online
 * *permanently* — nothing else ever revisits presence, so the only cure was for
 * them to connect and disconnect again cleanly. Redeploys are exactly when
 * every socket closes at once, so this went wrong in bulk or not at all.
 *
 * As a sorted set the pending transition is durable and ownerless: any instance
 * can sweep it, and whichever one wins the ZREM is the one that finalises it.
 */
const OFFLINE_PENDING_KEY = 'offline_pending';

/** How often each instance looks for transitions that have come due. */
const OFFLINE_SWEEP_INTERVAL_MS = 5_000;

/** Ceiling on one sweep, so a large backlog is drained over several passes. */
const OFFLINE_SWEEP_BATCH = 200;

export class WebSocketController {
  private offlineSweeper?: NodeJS.Timeout;

  /*
   * A `MessageService` was injected here and never used. Messages sent over the
   * socket do not come through this controller — the client posts them to
   * `POST /messages/:id/send` and the socket carries the broadcast back — so
   * there was nothing for it to do. Dropping it also drops the reason this
   * controller had to know the message layer existed at all.
   */
  constructor(private websocketService: WebSocketService) {}

  /**
   * Begins sweeping due offline transitions. Every instance runs one; the ZREM
   * claim below is what stops them doing the same work twice.
   */
  public startPresenceSweeper(): void {
    if (this.offlineSweeper) return;

    this.offlineSweeper = setInterval(() => {
      void this.sweepPendingOffline().catch((error) =>
        logger.error('Presence sweep failed:', error),
      );
    }, OFFLINE_SWEEP_INTERVAL_MS);

    this.offlineSweeper.unref?.();
  }

  public stopPresenceSweeper(): void {
    if (this.offlineSweeper) clearInterval(this.offlineSweeper);
    this.offlineSweeper = undefined;
  }

  private async sweepPendingOffline(): Promise<void> {
    const due = await redisClient.zRangeByScore(
      OFFLINE_PENDING_KEY,
      '-inf',
      Date.now(),
      { LIMIT: { offset: 0, count: OFFLINE_SWEEP_BATCH } },
    );

    for (const userId of due) {
      // Claiming and checking are one step: ZREM answers 1 only for the caller
      // that actually removed the member, so exactly one instance proceeds.
      const claimed = await redisClient.zRem(OFFLINE_PENDING_KEY, userId);
      if (claimed === 0) continue;

      // They may have reconnected — possibly to another instance — between the
      // disconnect and now, in which case this transition is stale.
      const stillGone =
        await this.websocketService.isUserFullyDisconnected(userId);
      if (!stillGone) continue;

      await this.finalizeUserStatusUpdate(userId, 'offline');
    }
  }

  public handleIncomingMessage(
    ws: WebSocket,
    data: DTO.WebSocketMessage,
  ): void {
    // Set synchronously in the upgrade handler, before 'connection' is emitted,
    // so it is always present here. The setup layer already overwrites the
    // client-supplied ids with it; the handlers below take it directly so the
    // guarantee does not depend on remembering to stamp a new field.
    const authenticatedUserId = (ws as AuthenticatedWebSocket).userId;

    /*
     * An allowlist, not a dispatch table with a default. Membership events
     * (`conversation-join`, `conversation-leave`, `conversation-update`) are
     * things the *server* tells clients after it has changed the database via
     * the REST routes; no client has ever sent one. They were nevertheless
     * accepted here, and `handleConversationLeave` forwarded the payload
     * verbatim — no database lookup, no membership check — to whatever user ids
     * the sender listed. That let any authenticated user inject a fabricated
     * conversation into any other user's client, or tell them they had been
     * removed from a group.
     *
     * The fix is to stop treating an outbound event shape as an inbound
     * command. Anything not listed here is dropped.
     */
    switch (data.type) {
      case 'authenticate':
        // Auth is handled at WS upgrade — ignore post-connect authenticate messages
        logger.debug(
          'Ignoring post-connect authenticate message (handled at upgrade).',
        );
        break;
      case 'typing':
        this.handleTyping(data, authenticatedUserId);
        break;
      case 'message-status':
        this.handleMessageStatus(data, authenticatedUserId);
        break;
      case 'user-status':
        this.handleUserStatus(data, authenticatedUserId);
        break;
      default:
        logger.warn(
          `Rejected inbound WebSocket message of type "${(data as any).type}" from user ${authenticatedUserId}: not a client-sendable type.`,
        );
    }
  }

  public async handleDisconnect(ws: WebSocket): Promise<void> {
    const closed = await this.websocketService.logout(ws);
    if (!closed?.fullyDisconnected) return;

    const data: DTO.UserStatusMessage = {
      type: 'user-status',
      status: 'offline',
      user_id: closed.userId,
      last_seen: new Date().toISOString(),
    };
    // userId came from the socket bookkeeping in logout(), not from a client.
    await this.handleUserStatus(data, closed.userId);
  }

  private async handleTyping(
    data: DTO.TypingMessage,
    authenticatedUserId: string,
  ): Promise<void> {
    try {
      if (!ObjectId.isValid(data.conversation_id)) return;

      const conversation = await Conversation.findById(
        new ObjectId(data.conversation_id),
      )
        .select('participants')
        .lean();

      if (!conversation) {
        logger.warn(`No conversation found with id: ${data.conversation_id}`);
        return;
      }

      const senderId = String(data.sender?._id);

      // The whole sender object is forwarded for display, so a mismatch is
      // rejected rather than re-attributed: otherwise any client can make
      // anyone appear to be typing, under any name.
      if (senderId !== authenticatedUserId) {
        logger.warn(
          `Rejected typing event: socket ${authenticatedUserId} claimed to be ${senderId}`,
        );
        return;
      }

      const isParticipant = conversation.participants.some(
        (participantId) => String(participantId) === senderId,
      );
      if (!isParticipant) {
        logger.warn(
          `Rejected typing event from non-participant ${senderId} in ${data.conversation_id}`,
        );
        return;
      }

      await this.websocketService.sendToUsers(
        conversation.participants
          .map(String)
          .filter((participantId) => participantId !== senderId),
        {
          type: 'typing',
          is_typing: data.is_typing,
          sender: data.sender,
          conversation_id: data.conversation_id,
        },
      );
    } catch (error) {
      logger.error('Failed to handle typing notification:', error);
    }
  }

  private async handleMessageStatus(
    data: DTO.MessageStatusMessage,
    authenticatedUserId: string,
  ): Promise<void> {
    const { read_receipt, conversation_id } = data;
    try {
      const lastReadId = read_receipt?.last_message_read_id;

      if (
        !ObjectId.isValid(conversation_id) ||
        !ObjectId.isValid(read_receipt?.user_id) ||
        !lastReadId ||
        !ObjectId.isValid(lastReadId)
      ) {
        return;
      }

      // A receipt only ever speaks for the connection that sent it. Checking
      // participation alone let any member of a conversation clear another
      // member's badge and mark their messages read.
      if (String(read_receipt.user_id) !== authenticatedUserId) {
        logger.warn(
          `Rejected read receipt: socket ${authenticatedUserId} claimed to be ${read_receipt.user_id}`,
        );
        return;
      }

      // The sender must be a member of the conversation, and the message must
      // belong to it — otherwise any client could flip any message to READ.
      const membership = await Conversation.exists({
        _id: conversation_id,
        participants: new ObjectId(read_receipt.user_id),
      });
      if (!membership) {
        logger.warn(
          `Rejected read receipt from non-participant ${read_receipt.user_id}`,
        );
        return;
      }

      // The receipt becomes this user's unread watermark, and the watermark is
      // the message's timestamp — so a message from another conversation, or
      // one that does not exist, would silently move the count. Awaited and
      // checked rather than fired off, which is what let that through before.
      const readMessage = await Message.findOneAndUpdate(
        {
          _id: new ObjectId(lastReadId),
          conversation: new ObjectId(conversation_id),
        },
        { status: MessageStatusEnum.READ },
      )
        .select('_id')
        .lean();

      if (!readMessage) {
        logger.warn(
          `Rejected read receipt: message ${lastReadId} is not in conversation ${conversation_id}`,
        );
        return;
      }

      const userIdObj = new ObjectId(read_receipt.user_id);
      const lastReadObj = new ObjectId(read_receipt.last_message_read_id);

      // Server clock, not the sender's: `read_at` arrives off a client machine
      // and is the watermark two other derivations depend on.
      const readAt = new Date();

      const conversation = await upsertReadReceipt(
        conversation_id,
        userIdObj as unknown as Types.ObjectId,
        lastReadObj as unknown as Types.ObjectId,
        readAt,
      );

      if (!conversation) return;

      // Only after the receipt is persisted: the unread count is derived from
      // that watermark, so a createNotification racing this needs to see the
      // advanced one or it recomputes the message back into the badge.
      // Fire-and-forget — a failed recompute must not block the broadcast.
      recomputeNotification(
        read_receipt.user_id,
        conversation_id,
        lastReadId,
      ).catch((err) => logger.error('Failed to recompute notification:', err));

      await this.websocketService.sendToUsers(
        conversation.participants.map(String),
        {
          type: 'message-status',
          status: MessageStatusEnum.READ,
          read_receipt,
          conversation_id,
        },
      );
    } catch (error) {
      logger.error('Failed to handle message status update:', error);
    }
  }

  /**
   * `authenticatedUserId` is the identity the presence change is applied to.
   * It comes from the socket for inbound events and from the disconnect
   * bookkeeping on the way out — never from the payload, which previously let
   * any client mark any user online or offline.
   */
  private async handleUserStatus(
    data: DTO.UserStatusMessage,
    authenticatedUserId: string,
  ): Promise<void> {
    const { status } = data;
    const user_id = authenticatedUserId;

    if (status === 'online') {
      // Reconnecting cancels any transition still waiting out its delay.
      await redisClient.zRem(OFFLINE_PENDING_KEY, user_id);
      await this.finalizeUserStatusUpdate(user_id, 'online');
      return;
    }

    /*
     * Record when this should take effect and let the sweeper finish the job.
     *
     * NX rather than a plain ZADD: a second disconnect while one is already
     * pending must not push the due time further out, or a client that flaps
     * could stay "online" indefinitely. It also makes this the whole of the
     * previous `EXISTS`-then-`SETEX` dance, without the gap between the two.
     */
    await redisClient.zAdd(
      OFFLINE_PENDING_KEY,
      { score: Date.now() + OFFLINE_DELAY_MS, value: user_id },
      { NX: true },
    );
  }

  /**
   * `last_seen` is stamped from the server clock, not from the frame.
   *
   * The client sends one, and it was written through unvalidated — so any
   * client could put its contacts' "last seen" wherever it liked, including in
   * the future, and a device with a wrong clock did the same by accident. It is
   * the one field here that is purely an observation the server makes.
   */
  private async finalizeUserStatusUpdate(
    userId: string,
    status: 'online' | 'offline',
  ): Promise<void> {
    try {
      const lastSeen = new Date();

      const updated = await User.findByIdAndUpdate(
        userId,
        { status, last_seen: lastSeen },
        { returnDocument: 'after', select: 'privacy' },
      ).lean();

      // The presence is still recorded — the user's own devices rely on it —
      // but "nobody" means it is never announced to anyone else.
      if (!broadcastsPresence(updated?.privacy)) return;

      // Only notify users who share a conversation — not ALL connected users
      const sharedConversations = await Conversation.find({
        participants: userId,
      })
        .select('participants')
        .lean();

      const notifyIds = [
        ...new Set(
          sharedConversations
            .flatMap((c) => c.participants.map(String))
            .filter((id) => id !== userId),
        ),
      ];

      await this.websocketService.sendToUsers(notifyIds, {
        type: 'user-status',
        user_id: userId,
        status,
        last_seen: lastSeen.toISOString(),
      });
    } catch (error) {
      logger.error(`Failed to finalize user status for ${userId}:`, error);
    }
  }
}
