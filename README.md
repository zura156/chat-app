# Angular & Express Chat Application

A real-time chat application with direct and group messaging, media attachments,
and background media processing. Angular 22 frontend, Express 5 backend.

## Overview

Users exchange text, images, video, audio and files in one-to-one or group
conversations. Messages are delivered over a WebSocket connection; attachments
are uploaded straight to S3-compatible storage via presigned URLs, then picked up
by a background worker that scans them for viruses and transcodes them into the
variants the client actually renders.

## Features

- Real-time messaging over WebSocket, with typing indicators and notifications
- Direct and group conversations, including member management
- Message editing and deletion (deletion is soft — see `CHANGELOG.md` for why)
- Attachments: images, video, audio and arbitrary files
- Background media pipeline — virus scanning, image resizing, video/audio
  transcoding, thumbnail extraction
- Read receipts, per-conversation mute, and per-conversation media/file browsing
- Authentication with email verification, password reset, account lockout and
  reCAPTCHA
- Two-factor authentication — an authenticator app (TOTP), emailed codes, or
  both — with single-use recovery codes
- Session management: list your active sessions and revoke one or all of them,
  which refuses the access token already in that browser and closes its socket
- Blocking and per-field privacy visibility (last seen, profile picture, bio,
  online status)
- Mobile shell via Capacitor

## Tech Stack

### Frontend

- Angular 22 (standalone components, signals, new control flow)
- Tailwind CSS v4
- Spartan NG (`@spartan-ng/helm`) and Angular Material
- `@ng-icons/lucide`
- RxJS
- Capacitor (mobile builds)
- TypeScript

### Backend

- Express 5 on Node.js
- MongoDB with Mongoose 9
- Redis — rate limiting, presence and caching
- BullMQ — the `media-processing` queue, consumed by a separate worker process
- `ws` — WebSocket server
- S3-compatible object storage via `@aws-sdk/client-s3` (this deployment uses
  SeaweedFS)
- ffmpeg (`ffmpeg-static` + `fluent-ffmpeg`) and `sharp` for media processing
- ClamAV (`clamscan`) for attachment scanning
- JWT authentication with CSRF protection, Helmet, HPP and rate limiting
- Winston logging, Nodemailer for transactional mail

## Architecture

The backend runs as **two processes** that share MongoDB and Redis:

| Process | Entry point | Responsibility |
|---|---|---|
| API + WebSocket | `src/index.ts` | HTTP routes, auth, WebSocket connections |
| Media worker | `src/worker.ts` | Consumes the `media-processing` BullMQ queue |

Attachment flow:

1. Client asks the API for a presigned upload URL (`POST /upload/presign`).
2. Client uploads the file directly to the temp bucket.
3. Client confirms the upload (`POST /upload/confirm`), which enqueues a
   `media-processing` job.
4. The worker scans the file with ClamAV, transcodes or resizes it, writes the
   variants to the public or private bucket, and marks the attachment `ready`.
5. The API signs private-bucket URLs on read, so no signature is ever persisted.

The worker must be running for attachments to leave the `processing` state.

## Prerequisites

- Node.js v20.x or later
- npm v9.x or later
- MongoDB v6.x or later
- Redis v6.x or later
- An S3-compatible object store (SeaweedFS, MinIO, AWS S3, …)
- A reachable ClamAV instance for attachment scanning

ffmpeg does not need to be installed system-wide; `ffmpeg-static` supplies the
binary and the worker configures the path at startup.

## Installation

### Clone the repository

```bash
git clone https://github.com/zura156/chat-app.git
cd chat-app
```

### Backend setup

```bash
cd server
npm install

# create .env and fill in the variables listed below
touch .env

# API + WebSocket server
npm run dev
```

In a second terminal, start the media worker — without it, uploads never finish
processing:

```bash
cd server
npm run worker
```

### Frontend setup

```bash
# from the repository root
npm install
npm start          # or: ng serve
```

## Project Structure

```
chat-app/
├── src/                     # Angular 22 frontend
│   ├── app/
│   │   ├── features/
│   │   │   ├── auth/        # login, registration, password reset
│   │   │   ├── calls/       # call UI
│   │   │   ├── messages/    # conversation list, chatbox, message cards
│   │   │   ├── upload/      # file picker and upload pipeline
│   │   │   └── user/        # profile and settings
│   │   └── shared/          # components, directives, pipes, services,
│   │                        # interfaces, types, utils, validators
│   └── environments/        # environment.ts / environment.development.ts
├── server/                  # Express 5 backend (TypeScript)
│   └── src/
│       ├── auth/            # controllers, models, middlewares, services
│       ├── config/          # env, S3 and Redis configuration
│       ├── error-handling/  # error models and middleware
│       ├── messenger/       # conversations, messages, notifications
│       ├── processors/      # BullMQ job handlers (image, video, audio, file)
│       ├── templates/       # transactional email templates
│       ├── upload/          # presign, confirm, media URL signing
│       ├── user/            # user controllers, models, routers
│       ├── utils/           # shared utilities
│       ├── websocket/       # WebSocket server, controllers, services
│       ├── index.ts         # API entry point
│       └── worker.ts        # media worker entry point
├── public/                  # static assets
├── Dockerfile               # frontend build → nginx
├── nginx.conf               # nginx config for the built frontend
├── capacitor.config.ts
├── angular.json
├── components.json          # Spartan NG config
└── CHANGELOG.md
```

## API Endpoints

CSRF protection and the general rate limiter are applied to **every** router,
`/auth` included. `/auth` mixes public and authenticated routes — sign-in,
recovery and the endpoints redeemed from an email link are public; enrolment,
session management and anything changing a credential require a session. Every
other router additionally sits behind JWT authentication, and all but `/user`
behind a verified email address.

### Authentication — `/auth`

Sign-in and recovery — public:

| Method | Path | Description |
|---|---|---|
| GET | `/auth/csrf` | Issue a CSRF token (needed before the first mutating request, login included) |
| POST | `/auth/register` | Register a new user (rate limited) |
| POST | `/auth/login` | Log in — returns a two-factor challenge when a factor is enrolled (rate limited) |
| POST | `/auth/login/2fa` | Complete a two-factor sign-in with a code (rate limited) |
| POST | `/auth/login/2fa/email` | Send an email code partway through sign-in (rate limited) |
| POST | `/auth/logout` | Log out — deliberately unauthenticated, so it still works once the access token has expired; CSRF protected |
| POST | `/auth/refresh` | Exchange a refresh token for a new access token |
| POST | `/auth/forgot-password` | Request a reset email (rate limited) |
| POST | `/auth/reset-password` | Complete a password reset (rate limited) |
| POST | `/auth/verify-email` | Verify an email address |
| POST | `/auth/confirm-email` | Confirm an email change from the link sent to the new address |
| POST | `/auth/unlock-account` | Unlock an account locked by failed logins |

Two-factor enrolment — authenticated:

| Method | Path | Description |
|---|---|---|
| GET | `/auth/2fa` | Current two-factor status |
| POST | `/auth/2fa/setup` | Begin TOTP enrolment |
| POST | `/auth/2fa/confirm` | Confirm TOTP enrolment with a code |
| POST | `/auth/2fa/email/setup` | Begin email-factor enrolment |
| POST | `/auth/2fa/email/confirm` | Confirm email-factor enrolment with a code |
| POST | `/auth/2fa/email/send` | Send a code to a signed-in user about to change their factors |
| DELETE | `/auth/2fa/totp` | Disable the TOTP factor only |
| DELETE | `/auth/2fa/email` | Disable the email factor only |
| DELETE | `/auth/2fa` | Disable two-factor entirely |

An account may hold both factors, which is why removal exists per factor;
`DELETE /auth/2fa` keeps meaning "turn it all off" so older clients stay correct.

Sessions and credentials — authenticated:

| Method | Path | Description |
|---|---|---|
| GET | `/auth/sessions` | List active sessions |
| DELETE | `/auth/sessions` | Revoke every other session |
| DELETE | `/auth/sessions/:id` | Revoke one session |
| POST | `/auth/change-password` | Rotate a password you still know (rate limited) |
| POST | `/auth/change-email` | Request an email change; confirmed from the new inbox (rate limited) |
| POST | `/auth/cancel-email-change` | Cancel a pending email change |
| POST | `/auth/resend-verification` | Resend the verification email (rate limited) |

### Users — `/user`

| Method | Path | Description |
|---|---|---|
| GET | `/user/profile` | Get the current user |
| PATCH | `/user/profile` | Update the current user |
| DELETE | `/user/profile` | Delete the current user |
| GET | `/user` | List users |
| GET | `/user/search` | Search users |
| GET | `/user/privacy` | Get the privacy visibility settings |
| PATCH | `/user/privacy` | Update them (whitelisted on both key and value) |
| GET | `/user/blocked` | List the accounts you have blocked |
| POST | `/user/:id/block` | Block a user |
| DELETE | `/user/:id/block` | Unblock a user |
| GET | `/user/storage` | Storage used by the uploads this account owns |
| GET | `/user/export` | Download this account's data as JSON |
| GET | `/user/:id` | Get a user by id — 404s, not 403s, if either side has blocked the other |

A block is one-directional as data and bidirectional as an effect: every check
asks whether *either* party blocked the other. It is enforced on sending (both
entry points), starting a conversation, being added to a group, the DM lookup,
user search, the user list and the profile page. System INFO messages are exempt
— those are the app narrating membership changes, not a user reaching anyone.

### Conversations — `/conversations`

| Method | Path | Description |
|---|---|---|
| GET | `/conversations` | List the current user's conversations |
| POST | `/conversations` | Create a conversation |
| GET | `/conversations/search` | Search conversations |
| GET | `/conversations/find/:participantId` | Find a DM by participant |
| GET | `/conversations/muted` | List the conversations you have muted |
| GET | `/conversations/:id` | Get a conversation |
| PATCH | `/conversations/:id` | Update a conversation (name, picture) |
| DELETE | `/conversations/:id` | Delete a conversation |
| PATCH | `/conversations/:id/members` | Add or remove members |
| POST | `/conversations/:id/mute` | Mute a conversation |
| DELETE | `/conversations/:id/mute` | Unmute it, recomputing the badge |

Everything under `/:id` is behind `validateConversation`, which proves
membership. Mutes are permanent — `muted_until` is declared on the model and
never enforced, which is why the settings screen has no duration picker.

### Messages — `/messages`

| Method | Path | Description |
|---|---|---|
| POST | `/messages/:id/send` | Send a message to a conversation |
| GET | `/messages/:id/messages` | Get messages in a conversation |
| PATCH | `/messages/:id/messages/:messageId` | Edit a message (text only; stamps `edited_at`) |
| DELETE | `/messages/:id/messages/:messageId` | Delete a message (soft) |
| GET | `/messages/:id/media` | Get media attachments in a conversation |
| GET | `/messages/:id/files` | Get file attachments in a conversation |

`:id` is the conversation, whose membership the route middleware proves;
ownership of `:messageId` is checked in the service. Deletion is soft and has to
be — read receipts reference message ids and the unread count is derived from the
referenced message's timestamp, so removing the row would leave that user with no
watermark and mark the whole conversation unread. The row survives, emptied, and
renders as a tombstone.

### Notifications — `/notifications`

| Method | Path | Description |
|---|---|---|
| GET | `/notifications` | List notifications |
| PATCH | `/notifications/seen` | Mark notifications as seen |

### Uploads — `/upload`

| Method | Path | Description |
|---|---|---|
| POST | `/upload/presign` | Get a presigned URL for a direct upload |
| POST | `/upload/confirm` | Confirm an upload and enqueue processing |
| GET | `/upload/signed-url/:uploadId` | Get a signed read URL for an upload |

Upload contexts: `dm-image`, `dm-video`, `dm-audio`, `dm-file`, `avatar`,
`group-avatar`. Conversation attachments land in the private bucket; avatars are
public.

### Error responses

Every error the API returns has the same shape:

```jsonc
{
  "message": "Password: Use at least 8 characters. Username is already taken.",
  "code": "VALIDATION_FAILED",           // optional
  "errors": [                            // optional, one entry per field
    { "field": "password", "msg": "Use at least 8 characters." },
    { "field": "username", "msg": "is already taken" }
  ]
}
```

`message` is a complete sentence naming every field that failed and why — render
it directly. `errors[]` carries the same reasons split per field, for putting each
one under the input it belongs to rather than in a single banner. `code` is one
of `VALIDATION_FAILED`, `DUPLICATE`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`, `CSRF`
or `ALREADY_AUTHENTICATED`.

Clients should read these through `apiErrorMessage` / `apiFieldErrors` in
`src/app/shared/functions/api-error.ts`, which also covers a network failure, a
non-JSON error page, and the endpoints that answer `{ error }`.

## WebSocket

The client connects to `wsUrl` and authenticates over the socket itself. The
identity proven at the upgrade handshake is re-stamped onto every inbound
message, so a client cannot name someone else by supplying an id.

| Type | Direction | Purpose |
|---|---|---|
| `authenticate` | client → server | Authenticate the connection |
| `message` | both | New message |
| `message-edited` | server → client | A message's text changed |
| `message-deleted` | server → client | A message became a tombstone |
| `message-status` | both | Read receipt |
| `typing` | both | Typing indicator (membership-checked) |
| `user-status` | both | Presence |
| `conversation-update` | server → client | Name, picture or membership changed |
| `conversation-join` | server → client | You were added to a conversation |
| `conversation-leave` | server → client | You were removed, or it was deleted |
| `upload-ready` | server → client | The worker finished an attachment |
| `upload-failed` | server → client | Processing failed permanently |
| `upload-infected` | server → client | ClamAV rejected the file |
| `notification` | server → client | Unread count for the current user |
| `rate-limited` | server → client | The socket is over its message budget |

Keep-alive is the protocol's own ping/pong frames, not a JSON message — the
server pings and drops a client that does not answer.

Sockets are closed with code **4002** when the session behind them is revoked —
by `sid` for one named session, or by issue time for a bulk revocation.

Delivery is over Redis pub/sub (`ws:broadcast`, `ws:notification`, `ws:revoke`)
so it works across API instances. Anything pushing to users must go through the
broadcast helpers on `webSocketServiceInstance`; a bare `sendToUser` reaches only
the sockets attached to the local process, which looks correct on one machine and
drops messages in production.

## Environment Variables

### Backend (`server/.env`)

```
# Server
# The WebSocket shares this port — it attaches to the same HTTP server, so
# `wsUrl` on the client points at PORT, not at a second one.
PORT=3000
NODE_ENV=development
CLIENT_URL=http://localhost:4200
TRUSTED_PROXIES=          # comma-separated list; decides whether the address
                          # recorded against a session is the user's or a proxy's

# Database
MONGO_URI=your-mongo-uri

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# Secrets
COOKIE_SECRET=your-cookie-secret
SESSION_SECRET=your-session-secret
JWT_SECRET=your-jwt-secret            # also signs the 5-minute 2FA challenge
JWT_REFRESH_SECRET=your-refresh-token-secret
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
# The four secrets above, and COOKIE_DOMAIN below, throw at boot when
# NODE_ENV=production rather than falling back to a development default.
COOKIE_DOMAIN=localhost   # the CSRF cookie is set with a domain, and a browser
                          # silently drops one scoped to a host it is not on —
                          # every mutating request then 403s with nothing logged

# Two-factor
TWO_FACTOR_ISSUER=chat-app  # the label authenticator apps show next to the code

# Email verification gate
# Off by default. Verification shipped long before anything read its result, so
# every pre-existing account has is_email_verified: false and switching this on
# unconditionally locks out the whole user base. Run `npm run backfill:verified`
# to grandfather those accounts first, then set this to true.
REQUIRE_EMAIL_VERIFICATION=false

# Passwords
# Checks new passwords against Have I Been Pwned. The password never leaves the
# server — only the first five characters of its SHA-1 digest are sent, and the
# comparison happens locally (k-anonymity). On by default: NIST SP 800-63B rev. 4
# requires comparison against known compromised passwords, which the bundled list
# cannot do on its own. It fails open, so an HIBP outage cannot block sign-ups or
# resets, and a breaker stops it retrying a host that is unreachable. Set to
# false only where outbound HTTPS is unavailable by policy.
CHECK_BREACHED_PASSWORDS=true

# bcrypt work factor. 10 everywhere it is not set, and that is the number that
# matters — it is what protects a stolen password table. Configurable only so the
# test setup can drop it to 4 (a full hash is ~68ms at 10, ~2ms at 4, and every
# integration fixture creates users). Anything outside 4–15, or below 10 while
# NODE_ENV=production, is ignored and 10 is used.
BCRYPT_ROUNDS=10

# S3-compatible storage
S3_ENDPOINT=https://your-s3-endpoint
S3_APP_ACCESS=your-access-key
S3_APP_SECRET=your-secret-key
S3_QUARANTINE_ACCESS=quarantine-access-key
S3_QUARANTINE_SECRET=quarantine-secret-key
S3_BUCKET_PUBLIC=media-public
S3_BUCKET_PRIVATE=media-private
S3_BUCKET_QUARANTINE=media-quarantine
S3_BUCKET_TEMP=uploads-temp

# Virus scanning
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310

# Mail
SMTP_HOST=your-host
SMTP_PORT=your-port
SMTP_SECURE=false         # true for port 465, false for 587
SMTP_USER=your-email-address
SMTP_PASS=your-email-app-password

# Logging
LOG_LEVEL=info
LOG_DIR=                  # defaults to <cwd>/logs
LOG_SILENT=               # 1 silences every transport; the test setup sets it

# Misc
RECAPTCHA_SECRET_KEY=your-recaptcha-secret
WORKER_CONCURRENCY=4
```

`MONGO_TEST_URI`, `REDIS_TEST_URL` and `REQUIRE_INTEGRATION` only affect the test
run — see [Tests](#tests).

### Frontend (`src/environments/`)

There are two environment files. `environment.ts` holds the **production**
values and is the default; `angular.json` swaps in `environment.development.ts`
through `fileReplacements` on the `development` configuration, which is what
`ng serve` and `npm start` use. Edit the development file for local work — the
production one ships to users.

`environment.development.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  wsUrl: 'ws://localhost:3000',
  recaptchaSiteKey: 'your-recaptcha-site-key',
  s3Url: 'http://localhost:8333',
};
```

`environment.ts` takes the same shape with `production: true` and the deployed
API, WebSocket and storage URLs.

## Deployment

### Backend

```bash
cd server
npm run build
npm start          # API + WebSocket
npm run worker:prod # media worker, as a separate process
```

### Frontend

```bash
ng build --configuration production
```

Build artifacts land in `dist/chat-app/browser`. The included `Dockerfile` builds
the frontend and serves that directory with nginx using `nginx.conf`.

## Operational Notes

**Media hosting must support HTTP Range requests.** Chromium-based browsers
populate `video.seekable` only from responses that return `206 Partial Content`,
and refuse to seek without it — video plays but the timeline and arrow keys do
nothing. Firefox buffers the whole file and seeks anyway, so the problem shows up
in Chrome and Brave only. A CDN that compresses or caches media without a
`Content-Length` will strip `Accept-Ranges` and cause exactly this. Verify with:

```bash
curl -s -o /dev/null -D - -r 0-99 -H 'Accept-Encoding: identity' "<media url>"
```

Expect `206`, `accept-ranges: bytes` and `content-range`. See `CHANGELOG.md` for
the full diagnosis.

**The media worker is not optional.** Attachments stay in `processing` forever if
no worker is consuming the `media-processing` queue.

**Password policy follows NIST SP 800-63B rev. 4, with one deliberate
deviation.** There are no composition rules — no "must contain an uppercase
letter and a symbol". The requirements are an 8-character minimum, a
128-character maximum, all printable characters and Unicode accepted, and a check
against common, predictable and breached passwords.

The minimum is **OWASP ASVS 5.0 6.2.1's L1 floor, not NIST's 15**, and that is a
product call rather than a reading of the standard: NIST allows 8 only where a
second factor is *required*, and two-factor is opt-in here, so an account is
single-factor unless its owner has chosen otherwise. A 15-character minimum is
also the single largest source of drop-off on a sign-up form, and people who
cannot get past it reuse a password from elsewhere — the outcome the policy exists
to prevent. What it costs: an 8-character password is within offline-cracking
reach in a way a 15-character one is not, and bcrypt raises the cost per guess
without changing that.

Length was previously doing most of the blocklist's work — almost every entry in
the usual "top 10,000" lists is under 15 characters and was refused on length
before any rule could name it. At 8, `password`, `iloveyou` and `princess` are all
length-legal and none of them repeats, walks the keyboard or runs along the
alphabet, so the checks that used to be a backstop are now the control:
`looksTrivial`, a blocklist grown to cover the short end (matched after trailing
digits and punctuation are stripped, so `M0nkey!` reduces to `monkey`), and above
all the Have I Been Pwned check. That check fails open by design, so during an
outage `password-policy.ts` is the whole policy. If 2FA ever becomes mandatory —
or a tiered rule is added, 15 alone and 8 with a second factor —
`PASSWORD_MIN_LENGTH` is the only thing that needs to move.

**Registration and password changes make an outbound request to
`api.pwnedpasswords.com`,** unless you set `CHECK_BREACHED_PASSWORDS=false`. The
password is not sent: only the first five hex characters of its SHA-1 digest,
which match roughly one in a million entries of the corpus, with the comparison
done on your server. Disclosed here because it is a third-party request made on
behalf of your users, and it is on by default.

The rules live in `server/src/auth/services/password-policy.ts` and are mirrored
by `src/app/features/auth/validators/password.validator.ts`; the Mongoose
validator delegates to the same module. Change one and you must change the
other, and update the shared vector table both test suites run.

Existing accounts are unaffected: sign-in never validates the *format* of a
password, only that it matches. The minimum applies when a password is set —
registration, reset, change.

## Tests

Both halves of the project run on Vitest.

```bash
# Both suites, from the repository root
npm test           # client, then server
npm run test:ci    # the same, with REQUIRE_INTEGRATION=1
npm run typecheck  # client specs and server — the build configs exclude specs

# Backend only
cd server
npm test           # once
npm run test:watch # while working
npm run smoke      # end-to-end over HTTP against a running stack

# Frontend only
npm run test:client                            # or: ng test
npx ng test --include="**/api-error.spec.ts"   # a single spec
```

Backend specs come in two kinds, distinguished by filename:

| Pattern | Needs | What it covers |
|---|---|---|
| `*.spec.ts` | nothing | Pure logic — TOTP against the RFC vectors, token typing, CSRF comparison, pagination clamps, privacy redaction |
| `*.int.spec.ts` | MongoDB, Redis | Things that only exist against a real server — unique indexes, concurrent read receipts, `select: false`, the account-deletion cascade, the pending-offline queue |

The integration specs are **skipped, not failed**, when the services are not
reachable, so `npm test` is always runnable:

```
[integration] No MongoDB at mongodb://127.0.0.1:27017/chat_app_test — those suites will be skipped.
```

Point them elsewhere with `MONGO_TEST_URI` and `REDIS_TEST_URL`. They use a
separate database and drop every collection between tests, so do not aim them at
anything you care about.

Because they skip rather than fail, a green local run can silently cover far less
than a full one. `REQUIRE_INTEGRATION=1` turns the skip into a hard failure, which
is what `npm run test:ci` sets.

The suite pins three variables, all overridable: `CHECK_BREACHED_PASSWORDS=false`
keeps it off `api.pwnedpasswords.com`, `LOG_SILENT=1` silences winston (use
`LOG_SILENT=0 npm test` to see what a spec is doing), and `BCRYPT_ROUNDS=4` keeps
fixture users from spending seconds of the run proving bcrypt still works.

Some of these are regression tests for bugs that a mock could not have caught —
the membership broadcast that named its recipients by `toString()`-ing populated
Mongoose documents, for instance, produces perfectly typed garbage and only
misbehaves against a real `populate()`. Where a spec exists for that reason, the
file header says so.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
