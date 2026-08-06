import { defineConfig } from 'vitest/config';

/*
 * Two tiers of test, distinguished only by what they need to be running:
 *
 *   - `src/**\/*.spec.ts` — pure logic. No network, no database, no clock
 *     games. These must pass anywhere, always.
 *   - `src/**\/*.int.spec.ts` — the invariants that only exist once MongoDB and
 *     Redis are involved: index behaviour, concurrent writes, cascading
 *     deletes. They skip themselves with an explanatory message when the
 *     services are unreachable, so a plain `npm test` on a laptop with nothing
 *     running still reports green for what it actually checked rather than
 *     failing for reasons that are not about the code.
 *
 * See `src/test/env.ts` for the connection settings.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globals: false,
    // Probes MongoDB and Redis once, before anything is collected, and reports
    // the result through the environment. `describe.skip` is decided at
    // collection time, which is synchronous — so the answer has to exist before
    // then. See src/test/global-setup.ts.
    globalSetup: ['src/test/global-setup.ts'],
    // bcrypt, mongod round trips and the deliberate concurrency in the
    // integration tests are all slower than the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration specs share one database; running files in parallel against
    // it makes them flake for reasons that have nothing to do with the code.
    fileParallelism: false,
  },
});
