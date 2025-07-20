import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import { WebSocketService } from '../services/websocket.service';
import * as DTO from '../dtos/websocket.dto';
import { MessageService } from '../../messenger/services/message.service';
import { Conversation } from '../../messenger/models/conversation.model';
import { User } from '../../user/models/user.model';
import { Message } from '../../messenger/models/message.model';
import { MessageStatusEnum } from '../../messenger/interfaces/message.interface';

export class WebSocketController {
  private delayedOfflineUpdates = new Map<string, NodeJS.Timeout>();

  constructor(
    private websocketService: WebSocketService,
    private messageService: MessageService
  ) {}

  /**
   * Main entry point for all incoming WebSocket messages.
   * It acts as a router, directing the message to the correct handler.
   */
  public handleIncomingMessage(
    ws: WebSocket,
    data: DTO.WebSocketMessage
  ): void {
    switch (data.type) {
      case 'authenticate':
        this.websocketService.authenticate(data.user_id, ws);
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
          (data as any).type
        );
        break;
    }
  }

  public handleDisconnect(ws: WebSocket): void {
    const userId = this.websocketService.logout(ws);
    if (userId) {
      const data: DTO.UserStatusMessage = {
        type: 'user-status',
        status: 'offline',
        user_id: userId,
        last_seen: new Date().toISOString(),
      };
      this.handleUserStatus(data);
    }
  }

  private handleTyping(data: DTO.TypingMessage): void {
    Conversation.findById(data.conversation_id)
      .select('participants')
      .then((conversation) => {
        if (!conversation) return;
        for (const participantId of conversation.participants) {
          const participantStr = participantId.toString();
          if (participantStr !== data.sender._id) {
            this.websocketService.sendToUser(participantStr, {
              type: 'typing',
              is_typing: data.is_typing,
              sender: data.sender,
              conversation_id: data.conversation_id,
            });
          }
        }
      });
  }

  private async handleChatMessage(data: DTO.ChatMessage): Promise<void> {
    try {
      const { sender, conversation, content } = data.message;
      // The controller delegates the core task of creating a message to the MessageService.
      // The MessageService will save it and then call the broadcast function itself.
      await this.messageService.createTextMessage(
        sender._id!.toString() ?? sender.toString(),
        conversation.toString(),
        content as string
      );
    } catch (error) {
      logger.error('Failed to handle incoming chat message:', error);
    }
  }

  private async handleConversationJoin(
    data: DTO.ConversationJoinMessage
  ): Promise<void> {
    const { conversation, added_by } = data;
    try {
      const fullConversation = await Conversation.findById(
        conversation._id
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
    data: DTO.ConversationLeaveMessage
  ): Promise<void> {
    const { conversation, removed_by, removed_user } = data;
    try {
      // We also need to notify the user who was removed.
      const allRecipientIds = [
        ...(conversation.participants as any[]).map((p) => p._id),
        removed_user?._id,
      ];

      for (const userId of allRecipientIds) {
        this.websocketService.sendToUser(userId.toString(), data);
      }
    } catch (error) {
      logger.error('Error handling conversation-leave:', error);
    }
  }

  private async handleMessageStatus(
    data: DTO.MessageStatusMessage
  ): Promise<void> {
    const { read_receipt, conversation_id } = data;
    try {
      // Find the conversation to get all participants
      const conversation = await Conversation.findById(conversation_id)
        .select('participants')
        .lean();
      if (!conversation) return;

      // You could create a dedicated method in MessageService to update status and receipts
      // For now, we'll keep the logic here for clarity.
      await Message.findByIdAndUpdate(read_receipt.last_message_read_id, {
        status: MessageStatusEnum.READ, // Assuming status is 'read'
      });

      // Here you would also update the conversation's read_receipts array
      // ... logic to update conversation.read_receipts ...

      const payload = {
        type: 'message-status',
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
    lastSeen?: string
  ): Promise<void> {
    try {
      await User.findByIdAndUpdate(userId, {
        status,
        last_seen: lastSeen || new Date(),
      });

      // This is inefficient. In a real app, you'd only send this to users
      // who are "friends" or share a conversation with the updated user.
      // For this example, we'll notify everyone connected.
      const allUserIds = this.websocketService.getAllConnectedUserIds();
      const payload = {
        type: 'user-status',
        user_id: userId,
        status,
        last_seen: lastSeen,
      };

      for (const id of allUserIds) {
        if (id !== userId) {
          // Don't notify the user about their own status change
          this.websocketService.sendToUser(id, payload);
        }
      }
    } catch (error) {
      logger.error(`Failed to finalize user status for ${userId}:`, error);
    }
  }
}
