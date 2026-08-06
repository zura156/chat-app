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
- Attachments: images, video, audio and arbitrary files
- Background media pipeline — virus scanning, image resizing, video/audio
  transcoding, thumbnail extraction
- Read receipts and per-conversation media/file browsing
- Authentication with email verification, password reset, account lockout and
  reCAPTCHA
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

`/auth` is public apart from logout. Every other router sits behind CSRF
protection, JWT authentication and a general rate limiter.

### Authentication — `/auth`

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Log in (rate limited) |
| POST | `/auth/logout` | Log out (authenticated, CSRF protected) |
| POST | `/auth/refresh` | Exchange a refresh token for a new access token |
| POST | `/auth/forgot-password` | Request a reset email (rate limited) |
| POST | `/auth/reset-password` | Complete a password reset |
| POST | `/auth/verify-email` | Verify an email address |
| POST | `/auth/unlock-account` | Unlock an account locked by failed logins |

### Users — `/user`

| Method | Path | Description |
|---|---|---|
| GET | `/user/profile` | Get the current user |
| PATCH | `/user/profile` | Update the current user |
| DELETE | `/user/profile` | Delete the current user |
| GET | `/user` | List users |
| GET | `/user/search` | Search users |
| GET | `/user/:id` | Get a user by id |

### Conversations — `/conversations`

| Method | Path | Description |
|---|---|---|
| GET | `/conversations` | List the current user's conversations |
| POST | `/conversations` | Create a conversation |
| GET | `/conversations/search` | Search conversations |
| GET | `/conversations/find/:participantId` | Find a DM by participant |
| GET | `/conversations/:id` | Get a conversation |
| PATCH | `/conversations/:id` | Update a conversation (name, picture) |
| DELETE | `/conversations/:id` | Delete a conversation |
| PATCH | `/conversations/:id/members` | Add or remove members |

### Messages — `/messages`

| Method | Path | Description |
|---|---|---|
| POST | `/messages/:id/send` | Send a message to a conversation |
| GET | `/messages/:id/messages` | Get messages in a conversation |
| GET | `/messages/:id/media` | Get media attachments in a conversation |
| GET | `/messages/:id/files` | Get file attachments in a conversation |

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

## WebSocket

The client connects to `wsUrl` and authenticates over the socket itself.

| Type | Direction | Purpose |
|---|---|---|
| `authenticate` | client → server | Authenticate the connection |
| `message` | both | New or updated message |
| `typing` | both | Typing indicator |
| `notification` | server → client | Notification for the current user |
| `pong` | client → server | Keep-alive response |

## Environment Variables

### Backend (`server/.env`)

```
# Server
PORT=3000
WS_PORT=3001
NODE_ENV=development
CLIENT_URL=http://localhost:4200
TRUSTED_PROXIES=          # comma-separated list

# Database
MONGO_URI=your-mongo-uri

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# Secrets
COOKIE_SECRET=your-cookie-secret
SESSION_SECRET=your-session-secret
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-token-secret
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Passwords
# Checks new passwords against Have I Been Pwned. The password never leaves the
# server — only the first five characters of its SHA-1 digest are sent, and the
# comparison happens locally (k-anonymity). On by default: NIST SP 800-63B rev. 4
# requires comparison against known compromised passwords, which the bundled list
# cannot do on its own. It fails open, so an HIBP outage cannot block sign-ups or
# resets, and a breaker stops it retrying a host that is unreachable. Set to
# false only where outbound HTTPS is unavailable by policy.
CHECK_BREACHED_PASSWORDS=true

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
SMTP_USER=your-email-address
SMTP_PASS=your-email-app-password

# Misc
RECAPTCHA_SECRET_KEY=your-recaptcha-secret
WORKER_CONCURRENCY=4
```

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

**Password policy follows NIST SP 800-63B rev. 4.** There are no composition
rules — no "must contain an uppercase letter and a symbol". The requirements are
a 15-character minimum (the standard's floor for a password used as a single
factor, which is every account here until its owner enrols 2FA), a 128-character
maximum, all printable characters and Unicode accepted, and a check against
common, predictable and breached passwords.

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
# Backend
cd server
npm test           # once
npm run test:watch # while working
npm run typecheck  # type-checks the specs, which the build config excludes

# Frontend
ng test
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
