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

export class WebSocketController {
  private delayedOfflineUpdates = new Map<string, NodeJS.Timeout>();

  constructor(
    private websocketService: WebSocketService,
    private messageService: MessageService,
  ) {}

  /**
   * Main entry point for all incoming WebSocket messages.
   * It acts as a router, directing the message to the correct handler.
   */
  public handleIncomingMessage(
    ws: WebSocket,
    data: DTO.WebSocketMessage,
  ): void {
    switch (data.type) {
      case 'authenticate':
        this.websocketService
          .authenticate(data.user_id, ws)
          .catch((err) => logger.error('Auth error:', err));
        break;
      case 'message':
        this.handleChatMessage(data);
        break;
      case 'typing':
        this.handleTyping(data);
        break;
      case 'conversation-join':
        this.handleConversationJoin(data);
        break;
      case 'conversation-leave':
        this.handleConversationLeave(data);
        break;
      case 'message-status':
        this.handleMessageStatus(data);
        break;
      case 'user-status':
        this.handleUserStatus(data);
        break;
      default:
        logger.warn(
          'Unknown WebSocket message type received:',
          (data as any).type,
        );
        break;
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
      this.handleUserStatus(data);
    }
  }

  private async handleTyping(data: DTO.TypingMessage): Promise<void> {
    try {
      logger.debug('Typing data received:', data);

      const conversation = await Conversation.findById(
        new ObjectId(data.conversation_id),
      )
        .select('participants')
        .lean();

      if (!conversation) {
        logger.warn(`No conversation found with id: ${data.conversation_id}`);
        return;
      }

      for (const participantId of conversation.participants) {
        const participantStr = String(participantId);
        if (participantStr !== String(data.sender._id)) {
          logger.debug(`Sending typing event to user ${participantStr}`);

          try {
            this.websocketService.sendToUser(participantStr, {
              type: 'typing',
              is_typing: data.is_typing,
              sender: data.sender,
              conversation_id: data.conversation_id,
            });
          } catch (socketErr) {
            logger.error(
              `Failed to send typing to ${participantStr}:`,
              socketErr,
            );
          }
        }
      }
    } catch (error) {
      logger.error('Failed to handle typing notification:', error);
    }
  }

  private async handleChatMessage(data: DTO.ChatMessage): Promise<void> {
    try {
      const { sender, conversation, content } = data.message;
      // The controller delegates the core task of creating a message to the MessageService.
      // The MessageService will save it and then call the broadcast function itself.
      await this.messageService.createTextMessage(
        (sender as Partial<UserDTO>)?._id!.toString() ?? sender.toString(),
        conversation.toString(),
        content as string,
      );
    } catch (error) {
      logger.error('Failed to handle incoming chat message:', error);
    }
  }

  private async handleConversationJoin(
    data: DTO.ConversationJoinMessage,
  ): Promise<void> {
    const { conversation, added_by } = data;
    try {
      const fullConversation = await Conversation.findById(
        conversation._id,
      ).populate('participants');
      if (!fullConversation) return;

      const payload = {
        type: 'conversation-join',
        conversation: fullConversation,
        added_by,
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
    const { conversation, removed_by, removed_users } = data;
    try {
      // We also need to notify the user who was removed.
      const allRecipientIds = [
        ...(conversation.participants as any[]).map((p) => p._id),
        ...(removed_users
          ? removed_users.map((u) => (typeof u === 'string' ? u : u._id))
          : []),
      ];

      for (const userId of allRecipientIds) {
        this.websocketService.sendToUser(userId.toString(), data);
      }
    } catch (error) {
      logger.error('Error handling conversation-leave:', error);
    }
  }

  private async handleMessageStatus(
    data: DTO.MessageStatusMessage,
  ): Promise<void> {
    const { read_receipt, conversation_id } = data;
    try {
      // Update message status
      await Message.findByIdAndUpdate(read_receipt.last_message_read_id, {
        status: MessageStatusEnum.READ,
      });

      // Single atomic operation: update existing or add new read receipt
      const conversation = await Conversation.findOneAndUpdate(
        {
          _id: conversation_id,
          'read_receipts.user_id': new ObjectId(read_receipt.user_id),
        },
        {
          $set: {
            'read_receipts.$.last_message_read_id':
              read_receipt.last_message_read_id,
            'read_receipts.$.read_at': read_receipt.read_at,
          },
        },
        {
          new: true,
          select: 'participants',
        },
      );

      // If no document was found/updated, it means no existing receipt exists
      if (!conversation) {
        // Add new read receipt
        const updatedConversation = await Conversation.findByIdAndUpdate(
          conversation_id,
          {
            $push: {
              read_receipts: {
                ...read_receipt,
                user_id: new ObjectId(read_receipt.user_id),
              },
            },
          },
          {
            new: true,
            select: 'participants',
          },
        );

        if (!updatedConversation) return;

        // Broadcast to participants
        const payload = {
          type: 'message-status',
          status: MessageStatusEnum.READ,
          read_receipt,
          conversation_id,
        };

        for (const participantId of updatedConversation.participants) {
          this.websocketService.sendToUser(participantId.toString(), payload);
        }
      } else {
        // Broadcast to participants (conversation was updated)
        const payload = {
          type: 'message-status',
          status: MessageStatusEnum.READ,
          read_receipt,
          conversation_id,
        };

        for (const participantId of conversation.participants) {
          this.websocketService.sendToUser(participantId.toString(), payload);
        }
      }
    } catch (error) {
      logger.error('Failed to handle message status update:', error);
    }
  }

  private async handleUserStatus(data: DTO.UserStatusMessage): Promise<void> {
    const { user_id, status, last_seen } = data;
    const existingTimeout = this.delayedOfflineUpdates.get(user_id);

    // Cancel any pending 'offline' update if an 'online' message arrives
    if (status === 'online' && existingTimeout) {
      clearTimeout(existingTimeout);
      this.delayedOfflineUpdates.delete(user_id);
    }

    // Delay offline updates to handle brief disconnects/reconnects
    if (status === 'offline') {
      const timeout = setTimeout(() => {
        this.finalizeUserStatusUpdate(user_id, status, last_seen);
        this.delayedOfflineUpdates.delete(user_id);
      }, 30 * 1000); // 30-second delay
      this.delayedOfflineUpdates.set(user_id, timeout);
      return;
    }

    // Update 'online' status immediately
    this.finalizeUserStatusUpdate(user_id, status, last_seen);
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

      const allUserIds = await this.websocketService.getAllConnectedUserIds();
      const payload = {
        type: 'user-status',
        user_id: userId,
        status,
        last_seen: lastSeen,
      };

      for (const id of allUserIds) {
        if (id !== userId) {
          this.websocketService.sendToUser(id, payload);
        }
      }
    } catch (error) {
      logger.error(`Failed to finalize user status for ${userId}:`, error);
    }
  }
}
