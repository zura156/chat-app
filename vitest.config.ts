/*
 * There is no runnable Vitest project at the repository root — this file exists
 * to say so, loudly, instead of letting `vitest` here do something plausible
 * and wrong.
 *
 * Without it, a bare `vitest` at the root falls back to Vitest's defaults: the
 * node environment, no setup files, and a glob that matches the client specs
 * under `src/` *and* the server specs under `server/src/` at once. Every client
 * spec then fails on `sessionStorage is not defined` or a missing TestBed,
 * because the Angular harness those specs rely on is built by the `ng test`
 * builder and does not exist here. The result is a screenful of failures that
 * say nothing about the code, which is worse than no result at all.
 *
 * The two suites are genuinely separate and neither can be run this way:
 *
 *   npm test               both, in order
 *   npm run test:client    `ng test` — compiles the app, then runs it in jsdom
 *   npm run test:server    the Express suite, in node, against Mongo and Redis
 *
 * Safe to keep here: the Angular unit-test builder looks only for
 * `vitest-base.config.*` (see @angular/build .../unit-test/runners/vitest/
 * configuration.js) and disables Vitest's own config discovery when it finds
 * none, so `ng test` never loads this file.
 */
throw new Error(
  [
    '',
    'There is no Vitest project at the repository root.',
    '',
    '  npm test               run both suites',
    '  npm run test:client    the Angular app (via `ng test`)',
    '  npm run test:server    the Express server',
    '',
    'Running `vitest` here would test the client without its Angular harness',
    'and sweep in the server specs as well, failing for reasons unrelated to',
    'the code. See vitest.config.ts for why.',
    '',
  ].join('\n'),
);
