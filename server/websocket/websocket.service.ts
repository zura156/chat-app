import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import config from '../config/config';
import { logger } from '../utils/logger';
import { Message } from '../messenger/models/message.model';
import { webSocket } from 'rxjs/webSocket';
import { User } from '../user/models/user.model';

type MessageContentType = 'text' | 'image' | 'video' | 'file';
type WebSocketMessageType =
  | 'register'
  | 'typing'
  | 'message'
  | MessageContentType
  | 'user-status';

interface UserInterface {
  _id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  profile_picture?: string;
  last_seen: Date;
}

interface BaseWebSocketMessage {
  type: WebSocketMessageType;
}

interface RegisterMessage extends BaseWebSocketMessage {
  type: 'register';
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
  sender: Partial<UserInterface>;
  participants: Partial<UserInterface>[];
  content: string;
  conversation: string;
  _id?: string;
}

interface UserStatusMessage extends BaseWebSocketMessage {
  type: 'user-status';
  userId: string;
  status: 'online' | 'offline';
  last_seen?: Date;
}

type WebSocketMessage =
  | RegisterMessage
  | TypingMessage
  | ChatMessage
  | UserStatusMessage;

class WebSocketClientManager {
  private clients = new Map<string, WebSocket>();

  register(userId: string, ws: WebSocket): boolean {
    if (this.clients.has(userId)) {
      logger.warn(`User ${userId} is already registered`);
      return false;
    }
    this.clients.set(userId, ws);
    logger.info(`User ${userId} registered`);
    return true;
  }

  unregister(ws: WebSocket): string | null {
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
  constructor(protected clientManager: WebSocketClientManager) {}

  async handleMessage(ws: WebSocket, data: any): Promise<void> {
    logger.debug(`Received message type: ${data.type}`);

    // Type guard implementations for better type safety
    if (this.isRegisterMessage(data)) {
      this.handleRegisterMessage(ws, data);
    } else if (this.isTypingMessage(data)) {
      this.handleTypingMessage(data);
    } else if (this.isChatMessage(data)) {
      await this.handleChatMessage(ws, data);
    } else if (this.isUserStatusMessage(data)) {
      await this.handleUserStatus(ws, data);
      // } else if (this.isContactRequestMessage(data)) {
      //   await this.handleContactRequestMessage(ws, data);
      // } else if (this.isContactResponseMessage(data)) {
      //   await this.handleContactResponseMessage(ws, data);
    } else {
      this.handleUnknownMessage(ws, data);
    }
  }

  protected isRegisterMessage(data: any): data is RegisterMessage {
    return data.type === 'register' && typeof data.userId === 'string';
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
      data.sender &&
      Array.isArray(data.participants) &&
      typeof data.content === 'string' &&
      typeof data.conversation === 'string'
    );
  }

  protected handleRegisterMessage(
    ws: WebSocket,
    message: RegisterMessage
  ): void {
    if (!this.clientManager.register(message.userId, ws)) {
      ws.send(
        JSON.stringify({
          error: 'Registration failed. User may already be registered.',
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

  protected async handleChatMessage(
    ws: WebSocket,
    message: ChatMessage
  ): Promise<void> {
    const { sender, conversation, content, participants } = message;

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
      for (const recipient of participants) {
        if (!recipient._id) continue;

        if (this.clientManager.isConnected(recipient._id)) {
          this.clientManager.sendToUser(recipient._id, {
            _id: savedMessage._id,
            sender,
            content,
            type,
            conversation,
          });
        } else {
          logger.debug(`User ${recipient._id} is not connected`);
        }
      }

      // Send confirmation to sender as well
      if (sender._id) {
        this.clientManager.sendToUser(sender._id, savedMessage);
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
    const { status, userId, last_seen } = data;

    try {
      const user = await User.findById(userId);

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

      if (status === user.status && last_seen === user.last_seen) {
        return;
      }

      user.status = status;
      if (last_seen) {
        user.last_seen = last_seen;
      } else if (status === 'offline') {
        user.last_seen = new Date();
      }

      await user.save();
      logger.info(`User ${userId} status updated to ${status}`);

      // const contacts = await UserContact.find({ userId });
      // for (const contact of contacts) {
      //   this.clientManager.sendToUser(contact.contactId, {
      //     type: 'user-status',
      //     userId,
      //     status,
      //     last_seen: user.last_seen,
      //   });
      // }
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
    this.clientManager.unregister(ws);
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
