/**
 * Shared plumbing for the integration specs (`*.int.spec.ts`).
 *
 * These tests exercise things that only exist once a real MongoDB and Redis are
 * involved — unique indexes, `arrayFilters` under concurrency, `select: false`,
 * cascading deletes. Mocking those out would test the mock.
 *
 * Neither service is assumed to be running. `global-setup.ts` probes both once
 * before collection and reports the result through the environment; the helpers
 * here turn that into a real `describe.skip`, so `npm test` is always runnable
 * and never fails for reasons unrelated to the code.
 *
 * Point MONGO_TEST_URI / REDIS_TEST_URL elsewhere to use different instances.
 */
import mongoose from 'mongoose';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, describe } from 'vitest';
import { redisClient } from '../config/redis';

export const MONGO_TEST_URI =
  process.env.MONGO_TEST_URI ?? 'mongodb://127.0.0.1:27017/chat_app_test';

export const REDIS_TEST_URL =
  process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:6379';

/** Set by `global-setup.ts`, which is the only place that can probe in time. */
export const hasMongo = (): boolean =>
  process.env.VITEST_MONGO_AVAILABLE === 'true';

export const hasRedis = (): boolean =>
  process.env.VITEST_REDIS_AVAILABLE === 'true';

/**
 * Opens the shared client the services themselves reach for.
 *
 * `config/redis` exports a module-level client that nothing connects unless
 * `connectRedis()` is called, and only two specs called it. Every other
 * integration suite therefore ran against a *closed* client: cache
 * invalidation and the notification refresh both failed on every call, were
 * swallowed by their own try/catch, and logged "The client is closed" — 19
 * times per run. The suites still passed, because nothing asserted on the
 * Redis half of what they were exercising.
 *
 * Idempotent, and paired with `closeSharedRedis`, because the two suites that
 * manage the client themselves quit it in their own `afterAll` and files run
 * serially — so it may arrive here either open or closed.
 */
export const openSharedRedis = async (): Promise<void> => {
  if (!hasRedis() || redisClient.isOpen) return;
  await redisClient.connect();
};

export const closeSharedRedis = async (): Promise<void> => {
  if (redisClient.isOpen) await redisClient.quit();
};

/**
 * `describe` that connects Mongoose first, and skips the whole suite — naming
 * the URI it looked for — when there is nothing to connect to.
 *
 * The skip is a real `describe.skip`, not an early return from a hook. An early
 * return leaves the tests to run against a disconnected Mongoose, where every
 * query buffers and then times out: minutes of failures that all say "operation
 * buffering timed out" and none of which are about the code.
 */
export const describeIntegration = (name: string, suite: () => void): void => {
  if (!hasMongo()) {
    describe.skip(`${name} [no MongoDB at ${MONGO_TEST_URI}]`, suite);
    return;
  }

  describe(name, () => {
    beforeAll(async () => {
      await mongoose.connect(MONGO_TEST_URI, {
        // Fail fast rather than buffering: inside a test, a stalled query that
        // eventually times out is far harder to read than an immediate refusal.
        bufferCommands: false,
        serverSelectionTimeoutMS: 5_000,
      });
      // These suites drive services whose Redis side effects are incidental to
      // what is being asserted, but not optional — see `openSharedRedis`.
      await openSharedRedis();
    });

    afterAll(async () => {
      await mongoose.disconnect();
      await closeSharedRedis();
    });

    suite();
  });
};

/** As above, for suites that need Redis rather than MongoDB. */
export const describeRedisIntegration = (
  name: string,
  suite: () => void,
): void => {
  if (!hasRedis()) {
    describe.skip(`${name} [no Redis at ${REDIS_TEST_URL}]`, suite);
    return;
  }
  describe(name, suite);
};

/** A connected client for one suite. Only valid where Redis is available. */
export const openTestRedis = async (): Promise<RedisClientType> => {
  const client = createClient({
    url: REDIS_TEST_URL,
    socket: { reconnectStrategy: false },
  }) as RedisClientType;
  client.on('error', () => undefined);
  await client.connect();
  return client;
};

/** Drops every collection, so one spec cannot see another's fixtures. */
export const resetDatabase = async (): Promise<void> => {
  const { db } = mongoose.connection;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
};
