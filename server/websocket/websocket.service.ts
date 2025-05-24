import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import config from '../config/config';
import { logger } from '../utils/logger';
import { Message } from '../messenger/models/message.model';
import { User } from '../user/models/user.model';
import {
  MessageI,
  MessageStatusEnum,
  MessageTypeEnum,
} from '../messenger/interfaces/message.interface';
import { UserInterface } from '../user/interfaces/user.interface';
import { now, Types } from 'mongoose';

type MessageContentType = 'text' | 'image' | 'video' | 'file';
type WebSocketMessageType =
  | 'authenticate'
  | 'typing'
  | 'message'
  | 'message-status'
  | MessageContentType
  | 'user-status';

interface BaseWebSocketMessage {
  type: WebSocketMessageType;
}

interface AuthenticateMessage extends BaseWebSocketMessage {
  type: 'authenticate';
  userId: string;
}

interface TypingMessage extends BaseWebSocketMessage {
  type: 'typing';
  is_typing: boolean;
  sender: Partial<UserInterface>;
  participants: Partial<UserInterface>[];
  conversation: string;
}

interface ChatMessage extends BaseWebSocketMessage {
  type: 'message' | MessageContentType;
  message: MessageI;
  participants: Partial<UserInterface>[];
}

interface MessageStatusMessage extends BaseWebSocketMessage {
  type: 'message-status';
  last_message_id: string;
  sender_id: string;
  participants: Partial<UserInterface>[];
  status: 'sent' | 'delivered' | 'read';
}

interface UserStatusMessage extends BaseWebSocketMessage {
  type: 'user-status';
  userId: string;
  status: 'online' | 'offline';
  last_seen?: string;
}

type WebSocketMessage =
  | AuthenticateMessage
  | TypingMessage
  | ChatMessage
  | MessageStatusMessage
  | UserStatusMessage;

class WebSocketClientManager {
  private clients = new Map<string, WebSocket>();

  authenticate(userId: string, ws: WebSocket): boolean {
    if (this.clients.has(userId)) {
      logger.warn(`User ${userId} is already authenticated`);
      return false;
    }
    this.clients.set(userId, ws);
    logger.info(`User ${userId} authenticated`);
    return true;
  }

  logout(ws: WebSocket): string | null {
    for (const [userId, socket] of this.clients.entries()) {
      if (socket === ws) {
        this.clients.delete(userId);
        logger.info(`User ${userId} disconnected`);
        return userId;
      }
    }
    return null;
  }

  getConnections(): Map<string, WebSocket> {
    return new Map(this.clients);
  }

  sendToUser(userId: string, payload: any): boolean {
    const recipientSocket = this.clients.get(userId);
    if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
      try {
        recipientSocket.send(JSON.stringify(payload));
        return true;
      } catch (error) {
        logger.error(`Failed to send message to user ${userId}:`, error);
        return false;
      }
    }
    return false;
  }

  isConnected(userId: string): boolean {
    const socket = this.clients.get(userId);
    return socket !== undefined && socket.readyState === WebSocket.OPEN;
  }
}

// Message handler classes
class MessageHandler {
  private delayedOfflineUpdates = new Map<string, NodeJS.Timeout>();

  constructor(protected clientManager: WebSocketClientManager) {}

  async handleMessage(
    ws: WebSocket,
    data: WebSocketMessage | unknown
  ): Promise<void> {
    logger.debug(`Received message type: ${data}`);

    if (this.isRegisterMessage(data)) {
      this.handleAuthenticateMessage(ws, data);
    } else if (this.isTypingMessage(data)) {
      this.handleTypingMessage(data);
    } else if (this.isChatMessage(data)) {
      await this.handleChatMessage(ws, data);
    } else if (this.isUserStatusMessage(data)) {
      await this.handleUserStatus(ws, data);
    } else if (this.isMessageStatusMessage(data)) {
      await this.handleMessageStatus(ws, data);
    } else {
      this.handleUnknownMessage(ws, data);
    }
  }

  protected isRegisterMessage(data: any): data is AuthenticateMessage {
    return data.type === 'authenticate' && typeof data.userId === 'string';
  }

  protected isTypingMessage(data: any): data is TypingMessage {
    return (
      data.type === 'typing' &&
      data.sender &&
      Array.isArray(data.participants) &&
      typeof data.conversation === 'string'
    );
  }

  protected isChatMessage(data: any): data is ChatMessage {
    return (
      (data.type === 'message' || data.type === 'text') &&
      data.message.sender &&
      Array.isArray(data.participants) &&
      typeof data.message.content === 'string' &&
      typeof data.message.conversation === 'string'
    );
  }

  protected handleAuthenticateMessage(
    ws: WebSocket,
    message: AuthenticateMessage
  ): void {
    if (!this.clientManager.authenticate(message.userId, ws)) {
      ws.send(
        JSON.stringify({
          error: 'Registration failed. User may already be authenticated.',
        })
      );
    }
  }

  protected handleTypingMessage(message: TypingMessage): void {
    for (const participant of message.participants) {
      if (participant._id && participant._id !== message.sender._id) {
        this.clientManager.sendToUser(participant._id, {
          type: 'typing',
          is_typing: message.is_typing,
          sender: message.sender,
          conversation: message.conversation,
        });
      }
    }
  }

  protected isUserStatusMessage(data: any): data is UserStatusMessage {
    return (
      data.type === 'user-status' &&
      typeof data.userId === 'string' &&
      ['online', 'offline'].includes(data.status)
    );
  }

  protected isMessageStatusMessage(data: any): data is MessageStatusMessage {
    return (
      data.type === 'message-status' &&
      typeof data.last_message_id === 'string' &&
      ['sent', 'delivered', 'read'].includes(data.status) &&
      Array.isArray(data.participants) &&
      typeof data.sender_id === 'string'
    );
  }

  protected async handleChatMessage(
    ws: WebSocket,
    message: ChatMessage
  ): Promise<void> {
    const { sender, conversation, content } = message.message;

    try {
      // Standardize type to 'text' for DB storage
      const type = 'text';

      // Save message to database
      const savedMessage = await Message.create({
        sender,
        conversation,
        content,
        type,
      });

      logger.info('Message saved to DB:', savedMessage._id);

      // Send message to all participants
      for (const recipient of message.participants) {
        if (!recipient._id) continue;
        if (recipient._id === message.message.sender.toString()) continue;

        if (this.clientManager.isConnected(recipient._id)) {
          this.clientManager.sendToUser(recipient._id, {
            type: 'message',
            message: savedMessage,
            participants: message.participants,
          });
        } else {
          logger.debug(`User ${recipient._id} is not connected`);
        }
      }

      // Send confirmation to sender as well
      if (sender._id) {
        this.clientManager.sendToUser(sender._id, {
          type: 'message',
          message: savedMessage,
          participants: message.participants,
        });
      }
    } catch (err) {
      logger.error('Failed to save message:', err);
      ws.send(
        JSON.stringify({
          error: 'Failed to save message to database',
          details: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    }
  }

  protected async handleUserStatus(
    ws: WebSocket,
    data: UserStatusMessage
  ): Promise<void> {
    const { status, userId } = data;

    const existingTimeout = this.delayedOfflineUpdates.get(userId);

    if (status === 'online' && existingTimeout) {
      clearTimeout(existingTimeout);
      this.delayedOfflineUpdates.delete(userId);
      logger.info(`Cancelled delayed offline update for user ${userId}`);
      return;
    }

    if (status === 'offline') {
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        this._finalizeUserStatus(ws, data);
        this.delayedOfflineUpdates.delete(userId);
      }, 60 * 1000);

      this.delayedOfflineUpdates.set(userId, timeout);

      logger.info(`Scheduled delayed offline status update for user ${userId}`);
      return;
    }

    this._finalizeUserStatus(ws, data);
  }

  protected async handleMessageStatus(
    ws: WebSocket,
    data: MessageStatusMessage
  ): Promise<void> {
    const { last_message_id, status, participants, sender_id } = data;

    try {
      const message = await Message.findById(last_message_id);

      if (!message) {
        logger.warn(`Message ${last_message_id} not found in DB.`);
        ws.send(
          JSON.stringify({
            error: 'Message not found',
            last_message_id,
          })
        );
        return;
      }

      if (message && message.status === status) {
        logger.warn(`Message ${last_message_id} status could not be updated.`);
        ws.send(
          JSON.stringify({
            error: 'Message status could not be updated',
            last_message_id,
            status,
          })
        );
        return;
      }

      message.status = status as MessageStatusEnum;

      const readReceipts = {
        user_id: new Types.ObjectId(sender_id),
        read_at: now(),
      };
      message.readReceipts.push(readReceipts);
      await message.save();

      logger.info(`Message ${last_message_id} status updated to ${status}`);

      // Send update to all participants
      for (const recipient of participants) {
        if (!recipient._id) continue;
        logger.info(
          `Sending message status update to user ${recipient.username}`
        );

        if (this.clientManager.isConnected(recipient._id)) {
          this.clientManager.sendToUser(recipient._id, {
            type: 'message-status',
            status,
            sender_id,
            last_message_id,
            read_at: readReceipts.read_at,
          });
        } else {
          logger.debug(`User ${recipient._id} is not connected`);
        }
      }
    } catch (err) {
      logger.error('Failed to update message status:', err);
      ws.send(
        JSON.stringify({
          error: 'Failed to update message status in database',
          details: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    }
  }

  private async _finalizeUserStatus(
    ws: WebSocket,
    data: UserStatusMessage
  ): Promise<void> {
    const { status, userId } = data;
    const last_seen = new Date(data.last_seen ?? '');

    try {
      const user = await User.findById(userId);
      const now = new Date();

      if (!user) {
        logger.warn(`User ${userId} not found in database`);
        ws.send(
          JSON.stringify({
            error: 'User not found',
            userId,
          })
        );
        return;
      }

      const oldDate = new Date(user.last_seen);
      const isoDate = oldDate.toISOString();

      if (status === user.status && last_seen.toISOString() === isoDate) {
        return;
      }

      user.status = status;
      if (last_seen) {
        user.last_seen = last_seen;
      } else if (status === 'offline') {
        user.last_seen = now;
      }

      await user.save();
      logger.info(`User ${userId} status updated to ${status}`);

      const connectedUsers = this.clientManager.getConnections();

      for (const [connectedUserId] of connectedUsers.entries()) {
        if (connectedUserId === userId) continue;

        this.clientManager.sendToUser(connectedUserId, {
          type: 'user-status',
          userId,
          status,
          last_seen: user.last_seen,
        });
      }
    } catch (err) {
      logger.error('Failed to update user status:', err);
      ws.send(
        JSON.stringify({
          error: 'Failed to update user entity',
          details: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    }
  }

  protected handleUnknownMessage(ws: WebSocket, data: any): void {
    logger.warn('Unknown message type:', data.type);
    ws.send(
      JSON.stringify({
        error: 'Unknown message type',
        receivedType: data.type,
      })
    );
  }
}

// WebSocket server setup
export class WebSocketService {
  private wss?: WebSocketServer;
  private clientManager = new WebSocketClientManager();
  private messageHandler: MessageHandler;

  constructor() {
    this.messageHandler = new MessageHandler(this.clientManager);
  }

  initialize(server: Server): WebSocketServer {
    this.wss = new WebSocketServer({ server });

    logger.info(`WebSocket server initializing on port: ${config.port}`);

    this.wss.on('connection', this.handleConnection.bind(this));

    return this.wss;
  }

  private handleConnection(ws: WebSocket): void {
    logger.info(`WebSocket connection established on port: ${config.port}`);

    ws.on('message', (rawMessage) => this.handleRawMessage(ws, rawMessage));
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', (error) => this.handleError(ws, error));
  }

  private async handleRawMessage(
    ws: WebSocket,
    rawMessage: any
  ): Promise<void> {
    try {
      const data = JSON.parse(rawMessage.toString());
      await this.messageHandler.handleMessage(ws, data);
    } catch (err) {
      logger.error('Error processing WebSocket message:', err);
      ws.send(
        JSON.stringify({
          error: 'Invalid message format',
          details: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    }
  }

  private handleClose(ws: WebSocket): void {
    this.clientManager.logout(ws);
  }

  private handleError(ws: WebSocket, error: Error): void {
    logger.error('WebSocket error:', error);
    try {
      ws.send(JSON.stringify({ error: 'WebSocket error occurred' }));
    } catch (sendError) {
      logger.error('Failed to send error message to client:', sendError);
    }
  }

  // Expose method for sending messages from outside the WebSocket context
  public sendMessageToUser(userId: string, payload: any): boolean {
    return this.clientManager.sendToUser(userId, payload);
  }

  public getClientManager(): WebSocketClientManager {
    return this.clientManager;
  }
}

// Export a singleton instance for application-wide use
const webSocketService = new WebSocketService();

export const setupWebSocket = (server: Server): WebSocketServer => {
  return webSocketService.initialize(server);
};

export const getWebSocketService = (): WebSocketService => {
  return webSocketService;
};
