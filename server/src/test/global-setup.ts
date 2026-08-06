import mongoose from 'mongoose';
import { createClient } from 'redis';

/*
 * Decides, once per run and before any test is collected, whether the
 * integration specs can run at all.
 *
 * It has to happen here rather than inside the specs: `describe.skip` is chosen
 * at collection time, which is synchronous, and probing a socket is not. The
 * result is handed to the workers through the environment, which vitest
 * propagates to them.
 *
 * Getting this wrong is worse than it sounds. Without a real skip the suites
 * still run, every query buffers for `bufferTimeoutMS` and then throws, and a
 * machine with no MongoDB spends minutes producing failures that say nothing
 * about the code.
 */

const CONNECT_TIMEOUT_MS = 3_000;

const MONGO_TEST_URI =
  process.env.MONGO_TEST_URI ?? 'mongodb://127.0.0.1:27017/chat_app_test';

const REDIS_TEST_URL =
  process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:6379';

const probeMongo = async (): Promise<boolean> => {
  try {
    const connection = await mongoose
      .createConnection(MONGO_TEST_URI, {
        serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
      })
      .asPromise();
    await connection.close();
    return true;
  } catch {
    return false;
  }
};

const probeRedis = async (): Promise<boolean> => {
  const client = createClient({
    url: REDIS_TEST_URL,
    socket: { connectTimeout: CONNECT_TIMEOUT_MS, reconnectStrategy: false },
  });
  // node-redis emits 'error' on an unreachable server; unhandled, that takes
  // the whole run down rather than failing this one probe.
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.quit();
    return true;
  } catch {
    return false;
  }
};

export async function setup(): Promise<void> {
  /*
   * The breached-password check is on by default in every other environment,
   * and it calls api.pwnedpasswords.com. No spec exercises a path that reaches
   * it today, and the one spec about the check stubs `fetch` — but the default
   * means the next controller-level test to touch registration would quietly
   * start calling a third party from CI. Off here, explicitly, so that the "no
   * network" contract in vitest.config is something the setup enforces rather
   * than something the suite currently happens to satisfy.
   */
  process.env.CHECK_BREACHED_PASSWORDS ??= 'false';

  const [mongo, redis] = await Promise.all([probeMongo(), probeRedis()]);

  process.env.VITEST_MONGO_AVAILABLE = String(mongo);
  process.env.VITEST_REDIS_AVAILABLE = String(redis);

  if (!mongo) {
    console.warn(
      `\n[integration] No MongoDB at ${MONGO_TEST_URI} — those suites will be skipped.` +
        `\n              Start one, or set MONGO_TEST_URI, to run them.`,
    );
  }
  if (!redis) {
    console.warn(
      `\n[integration] No Redis at ${REDIS_TEST_URL} — those suites will be skipped.` +
        `\n              Start one, or set REDIS_TEST_URL, to run them.`,
    );
  }
}
