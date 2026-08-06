import { redisClient } from '../../config/redis';
import { logger } from '../../utils/logger';

export const WS_RATE_WINDOW_SECONDS = 10;

/**
 * A budget per message type, rather than one shared across all of them.
 *
 * Only three types are client-sendable, and they are not interchangeable: a
 * burst of typing transitions used to spend the same allowance a read receipt
 * needed, and a dropped receipt leaves an unread badge stale until something
 * happens to re-trigger it. Presence gets the smallest share because it should
 * only fire on connect, disconnect and tab focus — more than that is a bug in
 * the client, not a busy user.
 *
 * Anything unlisted (including frames that did not parse) falls to the default,
 * so garbage still meets a limit. The controller's allowlist rejects those on
 * content; this bounds how many it has to reject.
 */
export const WS_RATE_LIMITS: Record<string, number> = {
  typing: 30,
  'message-status': 60,
  'user-status': 10,
};
export const WS_RATE_LIMIT_DEFAULT = 20;

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until the bucket refills. Sent to the client so it can wait. */
  retryAfter: number;
}

export const rateKey = (messageType: string, userId: string): string =>
  `ws:rate:${messageType}:${userId}`;

/*
 * Counter and expiry in one atomic step, and one round trip.
 *
 * This was `INCR`, then `EXPIRE` only when the count came back as 1. A single
 * failure between the two — a dropped connection, a Redis restart, anything
 * that made the second call throw — left the key with no TTL at all, and
 * because the expiry was only ever set on the first increment, nothing would
 * ever give it one. The counter then climbed forever: that user was rate
 * limited on that message type permanently, told to retry in ten seconds by a
 * window that was never going to end, until someone deleted the key by hand.
 *
 * Reading the TTL back rather than assuming it also makes this self-healing — a
 * key already stuck without one is given an expiry the next time it is touched,
 * including keys left behind by the old code.
 */
export const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export async function checkRateLimit(
  userId: string,
  messageType: string,
): Promise<RateLimitVerdict> {
  const key = rateKey(messageType, userId);

  try {
    const [count, ttl] = (await redisClient.eval(RATE_LIMIT_SCRIPT, {
      keys: [key],
      arguments: [String(WS_RATE_WINDOW_SECONDS)],
    })) as [number, number];

    const limit = WS_RATE_LIMITS[messageType] ?? WS_RATE_LIMIT_DEFAULT;
    if (count <= limit) return { allowed: true, retryAfter: 0 };

    return {
      allowed: false,
      retryAfter: ttl > 0 ? ttl : WS_RATE_WINDOW_SECONDS,
    };
  } catch (error) {
    // Fails open, like every HTTP limiter. This used to throw straight into the
    // message handler's catch, so a Redis blip silently dropped every frame on
    // every socket and logged each one as "Invalid WebSocket message".
    logger.error('WS rate limit check failed, allowing message:', error);
    return { allowed: true, retryAfter: 0 };
  }
}
