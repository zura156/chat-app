import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import { Conversation } from '../../messenger/models/conversation.model';
import { MessageTypeEnum } from '../../messenger/interfaces/message.interface';
import { redisClient } from '../../config/redis';
import { randomUUID } from 'crypto';
import { participantsCacheKey } from '../../utils/conversation-cache';

/**
 * `recipientIds` overrides the conversation's current membership.
 *
 * Needed because a membership change has to be announced to the people it
 * removed, and by the time it is durable they are no longer participants — so
 * resolving recipients from the conversation, as the default path does, would
 * silently skip exactly the users the event is about.
 */
export type BroadcastFunction = (
  message: any,
  recipientIds?: string[],
) => Promise<void>;

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

    /*
     * Track in BOTH: the global set (for getAllConnectedUserIds) and the
     * per-instance set (for isUserFullyDisconnected).
     *
     * The EXPIRE is sequenced *after* the SADD that creates the key. These
     * three used to run concurrently in one Promise.all, and Redis gives no
     * ordering guarantee between them — EXPIRE on a key that does not exist yet
     * is a no-op returning 0, so the presence key could end up with no TTL at
     * all. The heartbeat re-applies one 30 seconds later, but a crash inside
     * that window left the key permanent and its users reported online forever,
     * which is precisely what the TTL exists to prevent.
     */
    await Promise.all([
      redisClient.sAdd('online_users', userId),
      redisClient.sAdd(INSTANCE_KEY, userId),
    ]);
    await redisClient.expire(INSTANCE_KEY, INSTANCE_KEY_TTL);

    logger.info(
      `User ${userId} authenticated (${this.clients.get(userId)!.size} local sessions)`,
    );
  }

  /**
   * Detaches a socket and reports what that meant for the user's presence.
   *
   * `fullyDisconnected` is answered here rather than by a second call from the
   * caller because establishing it requires scanning every instance's presence
   * key — doing that twice per disconnect is the kind of thing that only shows
   * up under load.
   */
  public async logout(
    ws: WebSocket,
  ): Promise<{ userId: string; fullyDisconnected: boolean } | null> {
    // The socket already knows who it belongs to — it is stamped at the
    // upgrade. Scanning every connected user to rediscover it made each
    // disconnect O(users online).
    const userId = (ws as { userId?: string }).userId;
    if (!userId) return null;

    const sockets = this.clients.get(userId);
    if (!sockets?.delete(ws)) return null;

    if (sockets.size > 0) return { userId, fullyDisconnected: false };

    this.clients.delete(userId);

    // This instance no longer holds a socket for them — but another one may.
    // Dropping them from the global set unconditionally reported users as
    // offline while they were still connected elsewhere, because the global
    // set is the union of all instances and only this instance's membership
    // has actually changed.
    await redisClient.sRem(INSTANCE_KEY, userId);

    const fullyDisconnected = await this.isUserFullyDisconnected(userId);
    if (fullyDisconnected) {
      await redisClient.sRem('online_users', userId);
    }

    return { userId, fullyDisconnected };
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

  /**
   * Delivers an already-formed payload to a set of users, on every instance.
   *
   * `sendToUser` only reaches sockets held by *this* process. That is fine for
   * the Redis subscriber (which is the other end of a fan-out that already
   * happened) but not for an event originating here: typing indicators, read
   * receipts and presence changes were all pushed with a bare `sendToUser`
   * loop, so under more than one API replica they only ever reached recipients
   * who happened to be connected to the same one. Everyone else saw no typing
   * indicator, no read receipt, and contacts stuck at their last known presence
   * — intermittently, and in a way that looks like a flaky client.
   *
   * `broadcast` is not usable for these: it derives its recipients from a
   * conversation and re-wraps message-shaped payloads. This is the plain
   * "these users, this payload, everywhere" primitive.
   */
  public sendToUsers = async (
    userIds: string[],
    payload: object,
  ): Promise<void> => {
    const participantIds = [...new Set(userIds.map(String))].filter(Boolean);
    if (participantIds.length === 0) return;

    for (const userId of participantIds) this.sendToUser(userId, payload);

    try {
      // Local delivery already happened, hence fromInstance — the subscriber
      // skips its own id so nobody is sent the same frame twice.
      await redisClient.publish(
        'ws:broadcast',
        JSON.stringify({ participantIds, payload, fromInstance: INSTANCE_ID }),
      );
    } catch (error) {
      logger.error('Failed to fan out to other instances:', error);
    }
  };

  public async getAllConnectedUserIds(): Promise<string[]> {
    return redisClient.sMembers('online_users');
  }

  public broadcast: BroadcastFunction = async (
    message: any,
    recipientIds?: string[],
  ): Promise<void> => {
    if (!message || !message.conversation) {
      logger.warn('Broadcast ignored: missing conversation.');
      return;
    }

    try {
      const conversationId = message.conversation._id || message.conversation;

      let participantIds: string[] | null = recipientIds
        ? [...new Set(recipientIds.map(String))]
        : null;

      const cached = participantIds
        ? null
        : await redisClient.get(participantsCacheKey(conversationId));

      if (participantIds) {
        // Caller named the recipients explicitly — do not consult membership.
      } else if (cached) {
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
