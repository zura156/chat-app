import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import { WebSocketService } from '../services/websocket.service';
import * as DTO from '../dtos/websocket.dto';
import { MessageService } from '../../messenger/services/message.service';
import { Conversation } from '../../messenger/models/conversation.model';
import { User } from '../../user/models/user.model';
import { Message } from '../../messenger/models/message.model';
import { MessageStatusEnum } from '../../messenger/interfaces/message.interface';
import { UserDTO } from '../../user/dtos/user.dto';
import { ObjectId } from 'mongodb';
import { redisClient } from '../../config/redis';
import { recomputeNotification } from '../../messenger/services/notification.service';
import type { AuthenticatedWebSocket } from '../websocket.setup';

const OFFLINE_DELAY_MS = 30_000;

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
      case 'conversation-join':
        this.handleConversationJoin(data);
        break;
      case 'conversation-leave':
        this.handleConversationLeave(data);
        break;
      case 'message-status':
        this.handleMessageStatus(data, authenticatedUserId);
        break;
      case 'user-status':
        this.handleUserStatus(data, authenticatedUserId);
        break;
      default:
        logger.warn('Unknown WebSocket message type:', (data as any).type);
    }
  }

  public async handleDisconnect(ws: WebSocket): Promise<void> {
    const userId = await this.websocketService.logout(ws);
    if (
      userId &&
      (await this.websocketService.isUserFullyDisconnected(userId))
    ) {
      const data: DTO.UserStatusMessage = {
        type: 'user-status',
        status: 'offline',
        user_id: userId,
        last_seen: new Date().toISOString(),
      };
      // userId came from the socket bookkeeping in logout(), not from a client.
      this.handleUserStatus(data, userId);
    }
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

  private async handleChatMessage(data: DTO.ChatMessage): Promise<void> {
    try {
      const { sender, conversation, content, tempId } = data.message;
      await this.messageService.createTextMessage(
        (sender as Partial<UserDTO>)?._id!.toString() ?? sender.toString(),
        conversation.toString(),
        content as string,
        undefined,
        tempId,
      );
    } catch (error) {
      logger.error('Failed to handle incoming chat message:', error);
    }
  }

  private async handleConversationJoin(
    data: DTO.ConversationJoinMessage,
  ): Promise<void> {
    try {
      const fullConversation = await Conversation.findById(
        data.conversation._id,
      ).populate('participants');
      if (!fullConversation) return;

      const payload = {
        type: 'conversation-join',
        conversation: fullConversation,
        added_by: data.added_by,
      };

      for (const participant of fullConversation.participants as any[]) {
        this.websocketService.sendToUser(participant._id.toString(), payload);
      }
    } catch (error) {
      logger.error('Error handling conversation-join:', error);
    }
  }

  private async handleConversationLeave(
    data: DTO.ConversationLeaveMessage,
  ): Promise<void> {
    try {
      const removedIds = new Set(
        (data.removed_users ?? []).map((u) =>
          String(typeof u === 'string' ? u : u._id),
        ),
      );

      // Remaining participants — still in the conversation, just update it
      for (const participant of data.conversation.participants as any[]) {
        const id = String(participant._id ?? participant);
        this.websocketService.sendToUser(id, {
          type: 'conversation-update',
          conversation: data.conversation,
        });
      }

      // Removed users — they leave
      for (const userId of removedIds) {
        this.websocketService.sendToUser(userId, data);
      }
    } catch (error) {
      logger.error('Error handling conversation-leave:', error);
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
      const readAt = new Date(read_receipt.read_at);

      const setExisting = () =>
        Conversation.findOneAndUpdate(
          { _id: conversation_id, 'read_receipts.user_id': userIdObj },
          {
            $set: {
              'read_receipts.$.last_message_read_id': lastReadObj,
              'read_receipts.$.read_at': readAt,
            },
          },
          { returnDocument: 'after', select: 'participants' },
        );

      let conversation = await setExisting();

      if (!conversation) {
        try {
          conversation = await Conversation.findByIdAndUpdate(
            conversation_id,
            {
              $push: {
                read_receipts: {
                  user_id: userIdObj,
                  last_message_read_id: lastReadObj,
                  read_at: readAt,
                },
              },
            },
            { returnDocument: 'after', select: 'participants' },
          );
        } catch (err: any) {
          if (err?.code === 11000) {
            // lost the race — another concurrent read event pushed first, update it instead
            conversation = await setExisting();
          } else {
            throw err;
          }
        }
      }

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

    if (status === 'online') {
      // Cancel any pending offline — del is a no-op if key doesn't exist
      await redisClient.del(`offline_pending:${user_id}`);
      await this.finalizeUserStatusUpdate(user_id, 'online', last_seen);
      return;
    }

    // Offline: use Redis TTL instead of in-memory setTimeout
    // Safe across instances and server restarts
    const alreadyPending = await redisClient.exists(
      `offline_pending:${user_id}`,
    );
    if (alreadyPending) return;

    await redisClient.setEx(
      `offline_pending:${user_id}`,
      OFFLINE_DELAY_MS / 1000,
      '1',
    );

    setTimeout(async () => {
      // Only finalize if key still exists (wasn't cancelled by reconnect)
      const stillPending = await redisClient.exists(
        `offline_pending:${user_id}`,
      );
      if (stillPending) {
        await redisClient.del(`offline_pending:${user_id}`);
        await this.finalizeUserStatusUpdate(user_id, 'offline', last_seen);
      }
    }, OFFLINE_DELAY_MS);
  }

  private async finalizeUserStatusUpdate(
    userId: string,
    status: 'online' | 'offline',
    lastSeen?: string,
  ): Promise<void> {
    try {
      await User.findByIdAndUpdate(userId, {
        status,
        last_seen: lastSeen || new Date(),
      });

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
