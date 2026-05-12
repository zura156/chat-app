import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import { Conversation } from '../../messenger/models/conversation.model';
import { MessageTypeEnum } from '../../messenger/interfaces/message.interface';
import { redisClient } from '../../config/redis';

export type BroadcastFunction = (message: any) => Promise<void>;

const MESSAGE_TYPES = new Set([
  MessageTypeEnum.INFO,
  MessageTypeEnum.TEXT,
  MessageTypeEnum.IMAGE,
  MessageTypeEnum.VIDEO,
  MessageTypeEnum.AUDIO,
  MessageTypeEnum.FILE,
]);

const INSTANCE_KEY = `online_users:${process.pid}`;

export class WebSocketService {
  private clients = new Map<string, Set<WebSocket>>();

  public async authenticate(userId: string, ws: WebSocket): Promise<void> {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(ws);

    // Track in BOTH: global set (for getAllConnectedUserIds) and per-instance set (for isUserFullyDisconnected)
    await Promise.all([
      redisClient.sAdd('online_users', userId),
      redisClient.sAdd(INSTANCE_KEY, userId),
    ]);

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
          // Remove from both keys — global membership reflects actual state
          await Promise.all([
            redisClient.sRem('online_users', userId),
            redisClient.sRem(INSTANCE_KEY, userId),
          ]);
        }

        return userId;
      }
    }
    return null;
  }

  public async isUserFullyDisconnected(userId: string): Promise<boolean> {
    const localSessions = this.clients.get(userId);
    if (localSessions && localSessions.size > 0) return false;

    // Use SCAN instead of KEYS to avoid blocking Redis
    let cursor = '0';
    do {
      const [nextCursor, keys] = (await redisClient.sendCommand([
        'SCAN',
        cursor,
        'MATCH',
        'online_users:*',
        'COUNT',
        '100',
      ])) as [string, string[]];
      cursor = nextCursor;

      for (const key of keys) {
        if (await redisClient.sIsMember(key, userId)) return false;
      }
    } while (cursor !== '0');

    return true;
  }

  public sendToUser(userId: string, payload: object): boolean {
    const sockets = this.clients.get(userId);
    if (!sockets || sockets.size === 0) return false;

    const serialized = JSON.stringify(payload);
    let sent = false;

    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(serialized); // reuse serialized string
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

      // Send locally first
      for (const userId of participantIds) {
        this.sendToUser(userId, payload);
      }

      // Publish for other instances — fromPid prevents double-delivery
      await redisClient.publish(
        'ws:broadcast',
        JSON.stringify({ participantIds, payload, fromPid: process.pid }),
      );
    } catch (error) {
      logger.error('Broadcast error:', error);
    }
  };

  public async registerInstance(): Promise<void> {
    await redisClient.del(INSTANCE_KEY);
    logger.info(`WebSocket instance registered (pid: ${process.pid})`);
  }
}
