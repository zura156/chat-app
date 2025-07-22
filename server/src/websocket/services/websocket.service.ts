import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import { Conversation } from '../../messenger/models/conversation.model';
import { MessageTypeEnum } from '../../messenger/interfaces/message.interface';
export type BroadcastFunction = (message: any) => Promise<void>;

export class WebSocketService {
  private clients = new Map<string, WebSocket>();

  public authenticate(userId: string, ws: WebSocket): void {
    if (this.clients.has(userId)) {
      logger.warn(
        `User ${userId} is already authenticated. Overwriting existing session.`
      );
    }
    this.clients.set(userId, ws);
    logger.info(`WebSocket client authenticated for user: ${userId}`);
  }

  public logout(ws: WebSocket): string | null {
    for (const [userId, clientWs] of this.clients.entries()) {
      if (clientWs === ws) {
        this.clients.delete(userId);
        logger.info(`WebSocket client for user ${userId} disconnected.`);
        return userId;
      }
    }
    return null;
  }

  public sendToUser(userId: string, payload: object): boolean {
    const client = this.clients.get(userId);
    if (client && client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(payload));
        return true;
      } catch (error) {
        logger.error(`Failed to send message to user ${userId}:`, error);
        return false;
      }
    }
    return false;
  }

  public getAllConnectedUserIds(): string[] {
    return Array.from(this.clients.keys());
  }

  public broadcast: BroadcastFunction = async (message: any): Promise<void> => {
    if (!message || !message.conversation) {
      logger.warn('Broadcast ignored: Message or conversation ID is missing.');
      return;
    }

    try {
      const conversationId = message.conversation._id || message.conversation;
      const conversation = await Conversation.findById(conversationId);

      if (!conversation) {
        logger.warn(
          `Broadcast ignored: Conversation ${conversationId} not found.`
        );
        return;
      }

      const payload = {
        type: 'message',
        message,
      };

      for (const participantId of conversation.participants) {
        this.sendToUser(
          participantId.toString(),
          [
            MessageTypeEnum.INFO,
            MessageTypeEnum.TEXT,
            MessageTypeEnum.IMAGE,
            MessageTypeEnum.VIDEO,
            MessageTypeEnum.AUDIO,
            MessageTypeEnum.FILE,
          ].includes(message.type)
            ? payload
            : message
        );
      }
    } catch (error) {
      logger.error('Error during broadcast:', error);
    }
  };
}
