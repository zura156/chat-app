import type { RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeRedisIntegration, openTestRedis } from '../../test/env';

/*
 * The pending-offline queue.
 *
 * A disconnect does not take effect for 30 seconds — long enough to ride out a
 * refresh or a backgrounded tab. That delay used to be an in-process
 * `setTimeout`, so the transition existed only in the memory of the one process
 * that saw the socket close: a redeploy inside the window dropped it, and the
 * user stayed marked online *permanently*, because nothing else ever revisits
 * presence. Redeploys close every socket at once, so it went wrong in bulk.
 *
 * These exercise the Redis semantics the sweeper is built on directly, against
 * a real server. `ZADD NX` and `ZREM`-as-a-claim are the whole design; if
 * either behaved differently the sweeper would either lose transitions or run
 * them on several instances at once, and neither shows up as an error.
 */

const KEY = 'offline_pending:test';
const OFFLINE_DELAY_MS = 30_000;

describeRedisIntegration('pending-offline queue', () => {
  let redis: RedisClientType;

  beforeAll(async () => {
    redis = await openTestRedis();
  });

  afterAll(async () => {
    await redis.del(KEY);
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.del(KEY);
  });

  const markPending = (userId: string, dueAt: number) =>
    redis.zAdd(KEY, { score: dueAt, value: userId }, { NX: true });

  const due = (now: number) =>
    redis.zRangeByScore(KEY, '-inf', now, { LIMIT: { offset: 0, count: 200 } });

  it('holds a disconnect until its delay has elapsed', async () => {
    const now = Date.now();

    await markPending('u1', now + OFFLINE_DELAY_MS);

    expect(await due(now)).toEqual([]);
    expect(await due(now + OFFLINE_DELAY_MS)).toEqual(['u1']);
  });

  it('does not push the due time out when a user flaps', async () => {
    const now = Date.now();

    // NX is what makes this true. A plain ZADD would reset the score on every
    // reconnect-disconnect cycle, so a flapping client never goes offline.
    await markPending('u1', now + OFFLINE_DELAY_MS);
    await markPending('u1', now + 10 * OFFLINE_DELAY_MS);

    expect(await redis.zScore(KEY, 'u1')).toBe(now + OFFLINE_DELAY_MS);
  });

  it('cancels a pending transition when the user comes back', async () => {
    const now = Date.now();

    await markPending('u1', now);
    await redis.zRem(KEY, 'u1'); // what handleUserStatus('online') does

    expect(await due(now + OFFLINE_DELAY_MS)).toEqual([]);
  });

  it('gives the claim to exactly one sweeper', async () => {
    const now = Date.now();
    await markPending('u1', now - 1);

    // Every instance sweeps; ZREM answering 1 only for the caller that actually
    // removed the member is what stops two of them finalising the same user.
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => redis.zRem(KEY, 'u1')),
    );

    expect(claims.filter((claimed) => claimed === 1)).toHaveLength(1);
    expect(claims.filter((claimed) => claimed === 0)).toHaveLength(7);
  });

  it('survives the process that queued it', async () => {
    const now = Date.now();

    // The regression: a second, unrelated connection sees the transition and
    // can finalise it. With a setTimeout this was unreachable by definition.
    await markPending('u1', now - 1);

    const otherInstance = await openTestRedis();
    try {
      const seen = await otherInstance.zRangeByScore(KEY, '-inf', now, {
        LIMIT: { offset: 0, count: 200 },
      });
      expect(seen).toEqual(['u1']);
      expect(await otherInstance.zRem(KEY, 'u1')).toBe(1);
    } finally {
      await otherInstance.quit();
    }
  });

  it('drains a backlog in batches rather than all at once', async () => {
    const now = Date.now();

    // A redeploy closes every socket at the same moment, so the realistic
    // shape here is hundreds of simultaneously-due transitions.
    for (let i = 0; i < 250; i++) await markPending(`u${i}`, now - 1);

    const batch = await redis.zRangeByScore(KEY, '-inf', now, {
      LIMIT: { offset: 0, count: 200 },
    });
    expect(batch).toHaveLength(200);
    expect(await redis.zCard(KEY)).toBe(250);
  });

  it('orders by due time, so the oldest transition is handled first', async () => {
    const now = Date.now();

    await markPending('later', now - 1_000);
    await markPending('earlier', now - 10_000);

    expect(await due(now)).toEqual(['earlier', 'later']);
  });
});
