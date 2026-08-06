import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RedisClientType } from 'redis';
import { describeRedisIntegration, openTestRedis } from '../../test/env';
import {
  RATE_LIMIT_SCRIPT,
  WS_RATE_LIMITS,
  WS_RATE_LIMIT_DEFAULT,
  WS_RATE_WINDOW_SECONDS,
  rateKey,
} from './ws-rate-limit';

/*
 * The counter behind the per-message-type WebSocket budget.
 *
 * The bug this pins was not in the limit but in the expiry. `INCR` and `EXPIRE`
 * were two calls, and the expiry was set only when the count came back as 1 —
 * so any single failure in between left a key that counted forever and reset
 * never. The user was rate limited on that message type until someone deleted
 * the key by hand, while being told every time to retry in ten seconds.
 *
 * Exercised against the real script rather than a reimplementation of it: the
 * atomicity is the entire point, and Lua that is merely described in a test
 * proves nothing about the Lua that runs.
 */

describeRedisIntegration('WebSocket rate limiting', () => {
  let redis: RedisClientType;

  const KEY = rateKey('typing', 'user-1');

  /** One call, exactly as `checkRateLimit` makes it. */
  const hit = async (key = KEY): Promise<[number, number]> =>
    (await redis.eval(RATE_LIMIT_SCRIPT, {
      keys: [key],
      arguments: [String(WS_RATE_WINDOW_SECONDS)],
    })) as [number, number];

  beforeAll(async () => {
    redis = await openTestRedis();
  });

  afterEach(async () => {
    await redis.del(KEY);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('counts up from one', async () => {
    expect((await hit())[0]).toBe(1);
    expect((await hit())[0]).toBe(2);
    expect((await hit())[0]).toBe(3);
  });

  it('sets an expiry on the first hit', async () => {
    await hit();
    const ttl = await redis.ttl(KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WS_RATE_WINDOW_SECONDS);
  });

  it('returns the live ttl, so the client is told when to retry', async () => {
    const [, ttl] = await hit();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WS_RATE_WINDOW_SECONDS);
  });

  it('does not extend the window on later hits', async () => {
    // A sliding expiry would let a client that keeps sending hold its own
    // bucket open indefinitely.
    await hit();
    await redis.expire(KEY, 3);
    await hit();
    expect(await redis.ttl(KEY)).toBeLessThanOrEqual(3);
  });

  it('gives an expiry back to a key that lost one', async () => {
    /*
     * The permanent-lockout case, reproduced exactly: a key with a count and no
     * TTL, which is what the old two-call version left behind whenever the
     * second call failed. Under that version this key was terminal — the
     * expiry was only ever set when the count was 1, and it never would be
     * again.
     */
    await redis.set(KEY, '500');
    await redis.persist(KEY);
    expect(await redis.ttl(KEY)).toBe(-1);

    const [count, ttl] = await hit();

    expect(count).toBe(501);
    expect(ttl).toBe(WS_RATE_WINDOW_SECONDS);
    expect(await redis.ttl(KEY)).toBeGreaterThan(0);
  });

  it('recovers on its own, without the key being deleted', async () => {
    // The consequence of the above: the window ends, so the lockout does too.
    await redis.set(KEY, '500');
    await redis.persist(KEY);

    await hit();
    await redis.expire(KEY, 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(await redis.exists(KEY)).toBe(0);
    expect((await hit())[0]).toBe(1);
  });

  it('keeps each message type in its own bucket', async () => {
    // A burst of typing must not spend the allowance a read receipt needs.
    const typing = rateKey('typing', 'user-2');
    const receipts = rateKey('message-status', 'user-2');

    try {
      await hit(typing);
      await hit(typing);
      expect((await hit(receipts))[0]).toBe(1);
    } finally {
      await redis.del([typing, receipts]);
    }
  });

  it('keeps each user in their own bucket', async () => {
    const other = rateKey('typing', 'user-3');
    try {
      await hit();
      await hit();
      expect((await hit(other))[0]).toBe(1);
    } finally {
      await redis.del(other);
    }
  });

  describe('the budgets themselves', () => {
    it('gives read receipts more room than presence', async () => {
      // Presence should fire on connect, disconnect and focus; a receipt
      // arrives for every message that lands while the chat is open.
      expect(WS_RATE_LIMITS['message-status']).toBeGreaterThan(
        WS_RATE_LIMITS['user-status'],
      );
    });

    it('has a default for anything unlisted, including junk', async () => {
      expect(WS_RATE_LIMIT_DEFAULT).toBeGreaterThan(0);
      expect(WS_RATE_LIMITS['not-a-real-type']).toBeUndefined();
    });
  });
});
