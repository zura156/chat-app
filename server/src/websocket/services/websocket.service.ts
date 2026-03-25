import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import { Conversation } from '../../messenger/models/conversation.model';
import { MessageTypeEnum } from '../../messenger/interfaces/message.interface';
import { redisClient } from '../../utils/redis';

export type BroadcastFunction = (message: any) => Promise<void>;

const MESSAGE_TYPES = new Set([
  MessageTypeEnum.INFO,
  MessageTypeEnum.TEXT,
  MessageTypeEnum.IMAGE,
  MessageTypeEnum.VIDEO,
  MessageTypeEnum.AUDIO,
  MessageTypeEnum.FILE,
]);

export class WebSocketService {
  // Local only — WS objects can't go in Redis
  private clients = new Map<string, Set<WebSocket>>();

  public async authenticate(userId: string, ws: WebSocket): Promise<void> {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(ws);

    // Track in Redis: which users are online (across all instances)
    await redisClient.sAdd('online_users', userId);
    logger.info(
      `User ${userId} authenticated (${this.clients.get(userId)!.size} local sessions)`,
    );
  }

  public async logout(ws: WebSocket): Promise<string | null> {
    for (const [userId, sockets] of this.clients.entries()) {
      if (sockets.has(ws)) {
        sockets.delete(ws);

        if (sockets.size === 0) {
          this.clients.delete(userId);
          // Only remove from Redis if no local sessions remain
          // Other instances may still have this user connected,
          // so use a per-instance key instead of a global flag
          await redisClient.sRem(`online_users:${process.pid}`, userId);
        }

        return userId;
      }
    }
    return null;
  }

  public async isUserFullyDisconnected(userId: string): Promise<boolean> {
    // No local sessions
    const localSessions = this.clients.get(userId);
    if (localSessions && localSessions.size > 0) return false;

    // Check if any OTHER instance still has the user connected
    const instanceKeys = await redisClient.keys('online_users:*');
    for (const key of instanceKeys) {
      const isMember = await redisClient.sIsMember(key, userId);
      if (isMember) return false;
    }

    return true;
  }

  public sendToUser(userId: string, payload: object): boolean {
    const sockets = this.clients.get(userId);
    if (!sockets || sockets.size === 0) return false;

    let sent = false;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
          sent = true;
        } catch (error) {
          logger.error(`Failed to send to user ${userId}:`, error);
        }
      }
    }
    return sent;
  }

  public async getAllConnectedUserIds(): Promise<string[]> {
    return redisClient.sMembers('online_users');
  }

  public broadcast: BroadcastFunction = async (message: any): Promise<void> => {
    if (!message || !message.conversation) {
      logger.warn('Broadcast ignored: missing conversation.');
      return;
    }

    try {
      const conversationId = message.conversation._id || message.conversation;
      const conversation = await Conversation.findById(conversationId)
        .select('participants')
        .lean();

      if (!conversation) {
        logger.warn(
          `Broadcast ignored: conversation ${conversationId} not found.`,
        );
        return;
      }

      const payload = MESSAGE_TYPES.has(message.type)
        ? { type: 'message', message }
        : message;

      const participantIds = conversation.participants.map((p) => p.toString());

      for (const userId of participantIds) {
        this.sendToUser(userId, payload);
      }
      // Publish to Redis — all instances (including this one) receive it
      await redisClient.publish(
        'ws:broadcast',
        JSON.stringify({ participantIds, payload, fromPid: process.pid }),
      );
    } catch (error) {
      logger.error('Broadcast error:', error);
    }
  };

  public async registerInstance(): Promise<void> {
    // Register this instance's online_users set, cleared on startup
    await redisClient.del(`online_users:${process.pid}`);
  }
}
