import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import { Conversation } from '../../messenger/models/conversation.model';
import { MessageTypeEnum } from '../../messenger/interfaces/message.interface';
import { redisClient } from '../../config/redis';
import { randomUUID } from 'crypto';
import { participantsCacheKey } from '../../utils/conversation-cache';

export type BroadcastFunction = (message: any) => Promise<void>;

/**
 * Unique per running process. `process.pid` is NOT usable here: every container
 * runs node as pid 1, so instances would collide on the presence key and drop
 * each other's broadcasts.
 */
export const INSTANCE_ID = randomUUID();

const MESSAGE_TYPES = new Set([
  MessageTypeEnum.INFO,
  MessageTypeEnum.TEXT,
  MessageTypeEnum.IMAGE,
  MessageTypeEnum.VIDEO,
  MessageTypeEnum.AUDIO,
  MessageTypeEnum.FILE,
]);

const INSTANCE_KEY = `online_users:${INSTANCE_ID}`;
// Presence keys expire so a crashed instance stops counting as online.
// Refreshed by heartbeat() well inside the TTL.
const INSTANCE_KEY_TTL = 90;
const INSTANCE_HEARTBEAT_MS = 30_000;

export class WebSocketService {
  private clients = new Map<string, Set<WebSocket>>();
  private presenceHeartbeat?: NodeJS.Timeout;

  public async authenticate(userId: string, ws: WebSocket): Promise<void> {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(ws);

    // Track in BOTH: global set (for getAllConnectedUserIds) and per-instance set (for isUserFullyDisconnected)
    await Promise.all([
      redisClient.sAdd('online_users', userId),
      redisClient.sAdd(INSTANCE_KEY, userId),
      redisClient.expire(INSTANCE_KEY, INSTANCE_KEY_TTL),
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

      let participantIds: string[] | null = null;
      const cached = await redisClient.get(participantsCacheKey(conversationId));

      if (cached) {
        participantIds = JSON.parse(cached);
      } else {
        const conversation = await Conversation.findById(conversationId)
          .select('participants')
          .lean();

        if (!conversation) {
          logger.warn(
            `Broadcast ignored: conversation ${conversationId} not found.`,
          );
          return;
        }

        participantIds = conversation.participants.map((p) => p.toString());

        // cache for 1 hour — invalidateParticipantsCache() clears it when
        // membership changes
        await redisClient.setEx(
          participantsCacheKey(conversationId),
          3600,
          JSON.stringify(participantIds),
        );
      }

      const payload = MESSAGE_TYPES.has(message.type)
        ? { type: 'message', message }
        : message;

      if (!participantIds || participantIds.length === 0) {
        logger.warn(
          `Broadcast warning: conversation ${conversationId} has no participants.`,
        );
        return;
      }

      // Send locally first
      for (const userId of participantIds) {
        this.sendToUser(userId, payload);
      }

      // Publish for other instances — fromInstance prevents double-delivery
      await redisClient.publish(
        'ws:broadcast',
        JSON.stringify({ participantIds, payload, fromInstance: INSTANCE_ID }),
      );
    } catch (error) {
      logger.error('Broadcast error:', error);
    }
  };

  public async registerInstance(): Promise<void> {
    await redisClient.del(INSTANCE_KEY);
    await this.reconcileGlobalPresence();

    // Keep this instance's presence key alive; if the process dies the key
    // expires and its users stop being reported as online.
    this.presenceHeartbeat = setInterval(() => {
      redisClient
        .expire(INSTANCE_KEY, INSTANCE_KEY_TTL)
        .catch((err) => logger.error('Presence heartbeat failed:', err));
    }, INSTANCE_HEARTBEAT_MS);
    this.presenceHeartbeat.unref?.();

    logger.info(`WebSocket instance registered (${INSTANCE_ID})`);
  }

  public stopInstance(): void {
    if (this.presenceHeartbeat) clearInterval(this.presenceHeartbeat);
    this.presenceHeartbeat = undefined;
  }

  /**
   * Rebuild the global online set from the live per-instance sets. Without this
   * a crash leaves users flagged online forever, since nothing removes them.
   */
  private async reconcileGlobalPresence(): Promise<void> {
    try {
      const instanceKeys: string[] = [];
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
        instanceKeys.push(...keys);
      } while (cursor !== '0');

      if (instanceKeys.length === 0) {
        await redisClient.del('online_users');
        return;
      }
      await redisClient.sendCommand([
        'SUNIONSTORE',
        'online_users',
        ...instanceKeys,
      ]);
    } catch (error) {
      logger.error('Failed to reconcile global presence set:', error);
    }
  }
}
