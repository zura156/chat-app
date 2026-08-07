# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Angular 22 chat client at the repo root, Express 5 backend in `server/`. `README.md` documents the
feature set, every endpoint, and all environment variables — read it for those rather than
rediscovering them. This file covers what the README does not: commands, the mechanisms that only
become visible after reading several files, and the invariants that span both halves.

## Two npm projects

The root `package.json` is the Angular client. `server/package.json` is a separate project with its
own dependencies and `tsconfig.json`. Server commands must run from `server/` or via
`npm --prefix server`.

```bash
# Client — repo root
npm start                                  # ng serve (uses environment.development.ts)
npm run build
npm run test:client                        # ng test → Vitest in jsdom, via @angular/build:unit-test
npx ng test --include="**/api-error.spec.ts"   # a single client spec

# Server — from server/
npm run dev                                # nodemon src/index.ts — API + WebSocket
npm run worker                             # the BullMQ media worker (see below)
npm test                                   # vitest run
npx vitest run src/auth/services/totp.service.spec.ts   # a single server spec
npx vitest run -t "rejects a reused code"               # a single test by name
npm run typecheck                          # tsc --noEmit -p tsconfig.spec.json

# Both — repo root
npm run typecheck                          # client specs + server
npm test                                   # client, then server
npm run test:ci                            # same, with REQUIRE_INTEGRATION=1
```

There is no lint target configured on either side.

`npm run typecheck` is not redundant with the build: `tsconfig.app.json` excludes the specs, so type
errors in test files only ever surface here.

Running bare `vitest` at the repo root throws a deliberate error. There is no root Vitest project;
without that guard it would sweep in both suites and fail the client specs for want of the Angular
harness. Use the scripts above.

## Tests

Both suites are Vitest. Server specs come in two tiers, distinguished by filename:

- `*.spec.ts` — pure logic, no external services, must pass anywhere.
- `*.int.spec.ts` — real MongoDB and Redis. Index behaviour, concurrency, `select: false`, cascading
  deletes.

`src/test/global-setup.ts` probes both services once before collection (it has to happen there —
`describe.skip` is decided synchronously) and reports through the environment. Integration suites
then **skip themselves with an explanatory message** when a service is unreachable, so `npm test`
is always runnable. That means a green run can silently cover ~40% fewer tests; `REQUIRE_INTEGRATION=1`
turns the skip into a hard failure, which is why `test:ci` sets it.

When writing an integration spec, use `describeIntegration` / `describeRedisIntegration` from
`server/src/test/env.ts`, never a bare `describe` — the helpers own connect/disconnect and the skip.
`resetDatabase()` drops every collection, so never point `MONGO_TEST_URI` at data you care about.

Global setup pins three env vars with `??=`, all overridable: `CHECK_BREACHED_PASSWORDS=false` (keeps
the suite off `api.pwnedpasswords.com`), `LOG_SILENT=1` (use `LOG_SILENT=0 npm test` to see what a
spec is doing), and `BCRYPT_ROUNDS=4`.

## Backend architecture

Two processes sharing MongoDB and Redis: `src/index.ts` (API + WebSocket) and `src/worker.ts` (the
`media-processing` BullMQ queue). **Attachments stay in `processing` forever if the worker is not
running** — this is the most common "the app is broken" symptom during local development.

### WebSocket fan-out is multi-instance

Each API process gets a `randomUUID()` `INSTANCE_ID` and owns a presence key `online_users:<id>`,
kept alive by a heartbeat so a dead process's key expires. Sockets for one user may live on any
instance, so delivery goes out over Redis pub/sub — `ws:broadcast` and `ws:notification` — and each
instance ignores messages carrying its own `fromInstance`.

Consequence: anything pushing to users must go through the broadcast helpers on
`webSocketServiceInstance`. A bare `sendToUser` reaches only sockets attached to the local process,
which looks correct on a single-instance laptop and drops messages in production.

### Middleware order in `src/index.ts` is load-bearing

`identifyForRateLimit` → `generalLimiter` → `ensureCsrfCookie` → `csrfProtection` are applied above
*every* mount, `/auth` included. Mounting a router above that block silently strips CSRF protection
and rate limiting from it — that exact bug existed and the file carries a comment explaining it.
`identifyForRateLimit` must stay first; it is the only thing before the routers that can distinguish
one signed-in user from another.

`requireVerifiedEmail` gates `/conversations`, `/messages`, `/notifications` and `/upload`. `/user`
is deliberately ungated so an unverified account can read its own profile and request a new link.

`start()` completes every connection — Mongo, Redis, limiters, WebSocket instance registration, both
pub/sub subscriptions — *before* `listen()`. Requests arriving during a partial startup came back as
"403 Invalid token", a failure that reads like a credential problem and is not one.

### Auth and sessions

JWT access/refresh with a session id (`sid`) in the payload. `auth/services/token.service.ts` is the
single place sessions are minted, listed, rotated and revoked — refresh rotation, per-session and
bulk revocation, `revokeSessionsBefore`, and the Redis access-token blacklist all live there. Sitting
on top: TOTP 2FA, recovery codes, and email OTP (`totp.service.ts`, `recovery-code.service.ts`,
`email-otp.service.ts`). `auth/auth.router.ts` is the authoritative list of routes and which guards
and limiters each carries; the README table mirrors it and must be updated alongside it.

### Upload pipeline

`POST /upload/presign` → client PUTs directly to the temp bucket → `POST /upload/confirm` enqueues a
`media-processing` job → the worker ClamAV-scans, transcodes/resizes, writes variants to the public
or private bucket, marks the attachment ready. Private-bucket URLs are signed on read in
`upload/media-url.service.ts`; a signature is never persisted. Contexts are the `UploadContext` union
in `upload/upload.types.ts`.

## Frontend architecture

### Zoneless change detection

The app runs `provideZonelessChangeDetection()`. A value a template reads must be a signal, or be
written during something that already schedules a pass (a template event binding, an async pipe). A
plain property mutated inside `setTimeout`, a promise callback or an `addEventListener` handler will
change without the view noticing — this has already bitten the audio recorder. Check this before
adding any component.

### CSRF

`withXsrfConfiguration` is deliberately absent. Angular's built-in XSRF interceptor only attaches the
header to same-origin relative URLs, and every request here goes to an absolute cross-origin
`apiUrl`. `httpOptionsInterceptor` sets `X-CSRF-Token` explicitly; `provideAppInitializer` fetches
the token before the app boots.

### Spartan UI components

`components.json` generates components into `libs/ui/<name>/`, imported as `@spartan-ng/helm/<name>`
through explicit `paths` entries in `tsconfig.json`. Adding a component means both a new
`libs/ui/<name>` directory **and** a new `paths` entry — the alias does not resolve by convention.

### Environments

`src/environments/environment.ts` holds **production** values and is the default. `angular.json`
swaps in `environment.development.ts` via `fileReplacements` on the `development` configuration,
which is what `ng serve` uses. Edit the development file for local work.

## Cross-cutting invariants

- **Password policy is mirrored in two places.** `server/src/auth/services/password-policy.ts` and
  `src/app/features/auth/validators/password.validator.ts`. Change one and you must change the other,
  and update the shared vector table both suites run. The rules follow NIST SP 800-63B rev. 4: 15
  character minimum, 128 maximum, all printable characters and Unicode, no composition rules — do not
  add "must contain an uppercase letter".
- **The root `tsconfig.json` excludes `server/`.** Without that exclusion TypeScript judges server
  code by the Angular app's flags (`noPropertyAccessFromIndexSignature`, `noUnusedLocals`), neither of
  which applies to it. Server code answers to `server/tsconfig.json`.
- **Comments in this repo carry rationale, not description.** Several document a bug that was already
  fixed once — a middleware's position, a config that throws on purpose, why a probe runs in global
  setup. Read the comment before restructuring the thing it sits on.

## MCP servers

`.mcp.json` provides two, and they are the fastest route to correct code here:

- **`angular`** — call `mcp__angular__get_best_practices` before writing or modifying Angular code. It
  returns standards specific to the installed version (v22), which is ahead of most training data;
  `search_documentation` answers API questions.
- **`spartan-ng`** — call `spartan_components_get` / `spartan_blocks_get` for a component's real API
  before using it, rather than inferring it from the shadcn equivalent.
