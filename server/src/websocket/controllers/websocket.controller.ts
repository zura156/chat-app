import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import { WebSocketService } from '../services/websocket.service';
import * as DTO from '../dtos/websocket.dto';
import { MessageService } from '../../messenger/services/message.service';
import {
  Conversation,
  upsertReadReceipt,
} from '../../messenger/models/conversation.model';
import type { Types } from 'mongoose';
import { User } from '../../user/models/user.model';
import { Message } from '../../messenger/models/message.model';
import { MessageStatusEnum } from '../../messenger/interfaces/message.interface';
import { UserDTO } from '../../user/dtos/user.dto';
import { ObjectId } from 'mongodb';
import { redisClient } from '../../config/redis';
import { recomputeNotification } from '../../messenger/services/notification.service';
import type { AuthenticatedWebSocket } from '../websocket.setup';
import { broadcastsPresence } from '../../user/services/privacy.service';

const OFFLINE_DELAY_MS = 30_000;

/**
 * How much longer the pending-offline key lives than the timer that reads it.
 * The two were equal, which meant the key was always gone before the timer
 * checked it. Any positive slack fixes that; this much also covers a process
 * that is briefly busy when the timer comes due.
 */
const OFFLINE_PENDING_TTL_GRACE_MS = 30_000;

export class WebSocketController {
  constructor(
    private websocketService: WebSocketService,
    private messageService: MessageService,
  ) {}

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

      for (const participantId of conversation.participants) {
        const participantStr = String(participantId);
        if (participantStr !== senderId) {
          this.websocketService.sendToUser(participantStr, {
            type: 'typing',
            is_typing: data.is_typing,
            sender: data.sender,
            conversation_id: data.conversation_id,
          });
        }
      }
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

      const payload = {
        type: 'message-status',
        status: MessageStatusEnum.READ,
        read_receipt,
        conversation_id,
      };

      for (const participantId of conversation.participants) {
        this.websocketService.sendToUser(participantId.toString(), payload);
      }
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
    const { status, last_seen } = data;
    const user_id = authenticatedUserId;

    const pendingKey = `offline_pending:${user_id}`;

    if (status === 'online') {
      // Cancel any pending offline — del is a no-op if key doesn't exist
      await redisClient.del(pendingKey);
      await this.finalizeUserStatusUpdate(user_id, 'online', last_seen);
      return;
    }

    // The key is the cancellation token: a reconnect deletes it, and the timer
    // below checks it before committing. It must therefore outlive the timer.
    // It previously had exactly OFFLINE_DELAY_MS of TTL, so by the time the
    // timer fired the key had already expired and the check read it as
    // "cancelled" — meaning users were essentially never marked offline.
    const alreadyPending = await redisClient.exists(pendingKey);
    if (alreadyPending) return;

    await redisClient.setEx(
      pendingKey,
      Math.ceil((OFFLINE_DELAY_MS + OFFLINE_PENDING_TTL_GRACE_MS) / 1000),
      '1',
    );

    setTimeout(() => {
      void (async () => {
        try {
          // Only finalize if we still own the key. DEL returns the number of
          // keys removed, so claiming it and checking are one atomic step —
          // EXISTS-then-DEL let a reconnect slip between the two and get
          // marked offline anyway.
          const claimed = await redisClient.del(pendingKey);
          if (claimed === 0) return;

          // The user may have reconnected to a different instance, in which
          // case they are still online and this transition is stale.
          const stillGone =
            await this.websocketService.isUserFullyDisconnected(user_id);
          if (!stillGone) return;

          await this.finalizeUserStatusUpdate(user_id, 'offline', last_seen);
        } catch (error) {
          logger.error(
            `Failed to finalize pending offline for ${user_id}:`,
            error,
          );
        }
      })();
    }, OFFLINE_DELAY_MS).unref?.();
  }

  private async finalizeUserStatusUpdate(
    userId: string,
    status: 'online' | 'offline',
    lastSeen?: string,
  ): Promise<void> {
    try {
      const updated = await User.findByIdAndUpdate(
        userId,
        {
          status,
          last_seen: lastSeen || new Date(),
        },
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

      const payload = {
        type: 'user-status',
        user_id: userId,
        status,
        last_seen: lastSeen,
      };

      for (const id of notifyIds) {
        this.websocketService.sendToUser(id, payload);
      }
    } catch (error) {
      logger.error(`Failed to finalize user status for ${userId}:`, error);
    }
  }
}
