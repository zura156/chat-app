# server/CLAUDE.md

Conventions for the Express 5 backend. The root `CLAUDE.md` covers commands, the test tiers, and the
architecture that spans both halves (WebSocket fan-out, middleware order, session lifecycle, the
upload pipeline) — this file is the layer below that: how code inside `server/src/` is expected to be
written.

## Layout

Feature directories (`auth/`, `user/`, `messenger/`, `upload/`, `websocket/`) hold their own
`controllers/`, `services/`, `models/`, `routers/`, `dtos/` and `middlewares/`. Cross-cutting pieces
live in `config/`, `utils/`, `error-handling/`, `processors/`, `templates/`, `test/` and `scripts/`.
Specs sit next to the code they test, never in a separate tree.

Controllers handle HTTP and delegate; the logic belongs in the service. `auth/` is flatter than the
rest for historical reasons (`auth.controller.ts`, `auth.router.ts` at the feature root) — follow the
local shape of whichever directory you are editing rather than reorganising it.

## Errors

Throw, do not hand-roll a response:

```ts
import { createCustomError } from '../error-handling/models/custom-api-error.model';
throw createCustomError('Conversation not found', 404);
```

`errorMiddleware` is the only place that formats an error response. It already translates Mongoose
`ValidationError` (into per-path messages, dropping Mongoose's aggregated wrapper), `CastError` → 400
"Invalid ID format", and duplicate key `11000` → 409 with the offending field named. Adding a
`try/catch` that returns `res.status(500)` bypasses all of that and loses the error log.

The response shape clients depend on is `{ message, code?, errors?: [{ field, msg }] }`. `message` is
a complete sentence naming every field that failed — every client in this app reads it first — and
`errors[]` carries the per-field breakdown so a form can render each reason under its input. Populate
both.

## Request validation

express-validator chains only *record* failures. Without `validateRequest` after them the validators
are inert and bad input falls through to Mongoose as a 500:

```ts
router.post('/thing', body('email').isEmail().withMessage('Valid email required'), validateRequest, handler);
```

`validateRequest` maps raw field paths to human labels via its `FIELD_LABELS` table — add an entry
there when you introduce a new body field, or the user sees the snake_case key.

Password fields must use the shared `passwordRule` helper in `auth/auth.router.ts`, which delegates to
`services/password-policy.ts`. Do not write a composition regex; see the root `CLAUDE.md` invariant
about the mirrored policy.

Emails are normalised only by `normalizeEmail` in `auth/auth.service.ts`. express-validator's
`normalizeEmail()` is deliberately unused — it strips Gmail dots and `+tags`, and applying it on one
route but not another once meant affected users could sign in but never receive a reset mail.

## Rate limiting

Limiters are built by `createRateLimiter` and must be constructed in `initLimiters()`, which `start()`
calls before the port opens. `identifyForRateLimit` runs before every router and is the only thing
that can key a bucket to a signed-in user rather than a shared IP.

Placement relative to validation is a real decision, not a style choice:

- Limiters that ration by **volume** (register, forgot-password, change-password) go **after** the
  validators, so a user fumbling the password rules does not spend their allowance on requests that
  never reached a handler.
- Limiters that ration **guessing** (login, anything verifying a six-digit code) go **first**.

Sending a code and guessing a code get separate limiters. Sharing one lets a user who requested a
second code burn the attempts needed to use the first.

## Logging

Use the winston `logger` from `utils/logger.ts`, never `console`. The console transport is not the one
that persists — unhandled 500s logged with `console.error` never reached `logs/error.log`. The logger
is silenced by `LOG_SILENT=1`, which the test global setup sets; `LOG_SILENT=0 npm test` gets output
back.

## Config

`config/config.ts` is a single default export and the only place `process.env` should be read outside
`test/` and `scripts/`. `config.bcryptRounds` refuses anything below 10 when `NODE_ENV=production`,
which is what keeps the suite's `BCRYPT_ROUNDS=4` from escaping.

## The media worker

`worker.ts` consumes the `media-processing` BullMQ queue defined in `config/queue.ts`; reuse the
exported `bullMQConnection` rather than opening another Redis client.

`processors/upload.processor.ts` dispatches through the `contextHandlers` map in
`processors/handlers/`, keyed by `UploadContext`. Adding an upload context means three edits: the
union in `upload/upload.types.ts`, a handler, and an entry in `handlers/index.ts`.

Only `dm-file` is ClamAV-scanned (`SCAN_CONTEXTS`) — media is re-encoded, which destroys any payload.
Attachment state transitions go through `utils/attachment-status.ts` (`markAttachmentStatus`,
`notifyAttachmentOutcome`) so the client is told; do not write `status` directly on the model.
`discardTempObject` is best-effort and idempotent because it runs on both the success path and the
worker's `failed` handler after retries are exhausted.

## Scripts

`src/scripts/` holds one-off maintenance tasks run with `npm run <name>` (`backfill:notifications`,
`backfill:verified`, `dedupe:notifications`, `diagnose:notifications`, `strip:deleted`). Several
mutate production data. `strip:deleted` takes `--dry`; check for an equivalent flag before running any
of the others against a real database, and prefer `diagnose:notifications`, which only reads.

## Specs

Unit specs (`*.spec.ts`) must not touch network, database or the clock. Anything needing a real
MongoDB or Redis is `*.int.spec.ts` and must use `describeIntegration` / `describeRedisIntegration`
from `src/test/env.ts` — see the root `CLAUDE.md` for why a bare `describe` with an early return is
worse than useless here.

Integration files run serially (`fileParallelism: false`) against one shared database, and
`resetDatabase()` drops every collection. Where a spec exists because a mock could not have caught the
bug — the membership broadcast that `toString()`-ed populated Mongoose documents, for instance — the
file header says so. Keep that note when editing.
