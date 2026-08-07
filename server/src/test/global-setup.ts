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

/**
 * Where the integration suites are *expected* to run, an unreachable service is
 * a broken environment rather than a reason to skip.
 *
 * Skipping is the right default: it keeps `npm test` useful on a laptop with
 * nothing running. But it means a run can drop the integration suites — a fifth
 * of the tests — and still exit 0, printing a warning that scrolls past above
 * the green summary. CI discovering that months later, after a real regression
 * shipped through the gap, is the failure this flag exists to prevent. Set it
 * anywhere the services are supposed to be up.
 */
const integrationRequired = (): boolean =>
  process.env.REQUIRE_INTEGRATION === '1' ||
  process.env.REQUIRE_INTEGRATION === 'true';

const startupHint = [
  'To run them, start the services locally:',
  '',
  '  mongod --dbpath /tmp/chat-app-test-db --port 27017 --fork \\',
  '         --logpath /tmp/chat-app-test-db/mongod.log',
  '  redis-server --daemonize yes',
  '',
  'or point MONGO_TEST_URI / REDIS_TEST_URL at instances you already have.',
].join('\n');

/** Indents every non-empty line, so the hint sits under the warning's margin. */
const indent = (text: string, by: string): string =>
  text.replace(/^(?!$)/gm, by);

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

  /*
   * Quiet the app logger. The specs that assert on failure paths necessarily
   * run the code that logs them, so a green run still printed two dozen stack
   * traces and appended them to `logs/error.log`. `??=` so it stays overridable:
   * `LOG_SILENT=0 npm test` when you need to see what a spec is doing.
   */
  process.env.LOG_SILENT ??= '1';

  /*
   * The cheapest work factor bcrypt accepts. Every integration fixture creates
   * users and each one pays a full hash — seconds per run, all of it spent
   * re-proving bcrypt rather than testing this code. `config.bcryptRounds`
   * refuses anything below 10 when NODE_ENV is production, so this cannot
   * escape the suite.
   */
  process.env.BCRYPT_ROUNDS ??= '4';

  const [mongo, redis] = await Promise.all([probeMongo(), probeRedis()]);

  process.env.VITEST_MONGO_AVAILABLE = String(mongo);
  process.env.VITEST_REDIS_AVAILABLE = String(redis);

  const missing = [
    mongo ? null : `MongoDB at ${MONGO_TEST_URI}`,
    redis ? null : `Redis at ${REDIS_TEST_URL}`,
  ].filter((entry): entry is string => entry !== null);

  if (missing.length === 0) return;

  if (integrationRequired()) {
    // Thrown from globalSetup, so the run stops here rather than reporting a
    // green summary over a suite that never ran.
    throw new Error(
      [
        '',
        `REQUIRE_INTEGRATION is set, but ${missing.length === 1 ? 'this service is' : 'these services are'} unreachable:`,
        ...missing.map((entry) => `  - ${entry}`),
        '',
        'The integration suites cannot run, and skipping them here would report',
        'success for tests that never executed.',
        '',
        startupHint,
        '',
      ].join('\n'),
    );
  }

  console.warn(
    [
      '',
      `[integration] Skipping the integration suites — ${missing.join(' and ')} ${
        missing.length === 1 ? 'is' : 'are'
      } unreachable.`,
      '',
      '              The run below therefore covers less than the whole suite,',
      '              and will still report success. Set REQUIRE_INTEGRATION=1 to',
      '              make this a failure instead.',
      '',
      indent(startupHint, '              '),
      '',
    ].join('\n'),
  );
}
