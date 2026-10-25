# Chat App — Full System Context

> Rewrite of the earlier "Full System Context" note, regenerated from the code as of 2026-10-20
> (branch `main`, HEAD `47b2efd` "integrate OpenID Connect"). Everything below was checked against the
> source except §12 (live infrastructure), which can only be carried over from the old note and is
> labelled as such. Where this file and `README.md` disagree, this file is newer — §15 lists the README's
> known drift.
>
> Companion docs, which this file does not duplicate: `README.md` (feature set, every endpoint, env
> vars), `CLAUDE.md` (commands + cross-cutting invariants), `server/CLAUDE.md` (backend conventions),
> `src/app/CLAUDE.md` (frontend conventions), `CHANGELOG.md` (history and the reasons behind fixes).
>
> **No secrets in this file.** The previous note contained live S3 keys, a Redis password and a
> Mongo URI. If that note was ever committed, shared or pasted anywhere, treat those values as
> compromised and rotate them (S3 admin/app/quarantine-writer keys, Redis password).

---

## 1. What changed since the old note

| Old note said | Reality now |
|---|---|
| Angular 21 | **Angular 22** (`@angular/core ^22.0.7`), zoneless, Vitest via `@angular/build:unit-test` |
| Upload contexts included `post-image`, `post-video`, `story-image`, `story-video` | **Removed.** `UploadContext` is now 7 values: `avatar`, `group-avatar`, `cover-photo`, `dm-image`, `dm-video`, `dm-file`, `dm-audio`. They were a free-storage grant for features that don't exist (`server/src/config/upload.config.ts`) |
| `media-hls` bucket, `S3_BUCKET_HLS`, HLS video (`variants.hls`) | **Gone.** Videos are one progressive MP4 in the private bucket (§5.3). HLS can't be served from a private bucket (sub-requests are unsigned). Buckets are public / private / quarantine / temp |
| Video poster key `poster` | Server writes and the client reads **`thumbnail`** (`hls` lingers only in a TS type) |
| DM image variants `thumb 320` / `medium 1280` | DM images use the same 64 / 400 / 1200 px set as avatars |
| `duration` inside `variants` | `duration` is its own field on the attachment and on `Upload` |
| Unique index on `Conversation.participants` | Replaced by scalar `dm_key` + partial unique index (§8.1) |
| Message statuses SENDING, SENT, READ, FAILED | Server enum is `failed`, `sent`, `delivered`, `read`; `sending` exists only client-side for optimistic bubbles |
| `general` limiter 100 / 5 min | 1000 signed-in / 300 anonymous per 5 min; presign 120 / 30 per min (§9.5) |
| Auth = JWT + CSRF | Full stack: rotating refresh tokens with session ids and reuse detection, TOTP + emailed-code 2FA, recovery codes, lockout, email-verification gate, HIBP check, revocation that closes live sockets, and Google/GitHub sign-in with connected accounts |
| WS events `upload-ready`, `upload-infected`, a handful more | Edit/delete, notification, `upload-failed`, `rate-limited`, plus a per-socket per-type rate limit and revocation close codes (§7) |
| "Signed GET not integrated in Angular" | Integrated: `SignedMediaService` re-signs on playback errors |
| "Avatar / group avatar upload UI not wired" | Wired (profile settings, chatbox settings). Cover photo is the only one still missing in the client |
| "`dm-audio` missing from message enum" / "recorder signal fix" | Both fixed |
| Posts / stories / live streaming on the roadmap | Not started; their upload contexts, handlers and bucket were **deleted**, not stubbed |
| Credentials pasted into the note | Removed — see the warning above |

---

## 2. Stack

- **Client** (repo root): Angular 22, standalone components + signals, zoneless change detection,
  Tailwind CSS v4, Spartan NG (`libs/ui/*`, imported as `@spartan-ng/helm/<name>`),
  `@ng-icons/lucide` (+ remixicon), `ngx-sonner` toasts, `ngx-scrollbar`, `ngx-smart-cropper`,
  `qrcode-generator` (2FA enrolment QR), Capacitor 8 (config only — see §15).
- **Server** (`server/`, separate npm project): Express 5, TypeScript 6, Mongoose 9, `redis` 5,
  BullMQ 5, `ws`, `@aws-sdk/client-s3` + presigner, `sharp`, `fluent-ffmpeg` + `ffmpeg-static`,
  `clamscan`, `music-metadata`, `nodemailer`, `winston`, `helmet`, `hpp`, `express-rate-limit` +
  `rate-limit-redis`, `express-validator`, `@exortek/express-mongo-sanitize`, `openid-client` 6
  (Google sign-in, and the token exchange for GitHub's plain OAuth 2.0).
- **Tests**: Vitest on both sides.
- **Infra**: Coolify, Cloudflare Tunnel + Traefik, SeaweedFS (S3), ClamAV, Redis, MongoDB (Atlas).

---

## 3. Processes and repository layout

Two npm projects (root = Angular client, `server/` = backend) and, at runtime, **three deployables**:

| Service | Entry | Notes |
|---|---|---|
| `frontend` | Angular build served by nginx (`Dockerfile`, `nginx.conf`, `security-headers.conf`) | Output `dist/chat-app/browser` |
| `backend` | `server/src/index.ts` → `dist/src/index.js` (`server/Dockerfile`) | Express API **and** the WebSocket server on the same HTTP server/port (`PORT`; there is no `WS_PORT` any more) |
| `worker` | `server/src/worker.ts` → `dist/src/worker.js` (`server/Dockerfile.worker`) | BullMQ consumer of `media-processing`. **Without it attachments stay `processing` forever** |
| `redis`, `mongodb`, `seaweedfs`, `clamav` | infrastructure | see §12 |

```
chat-app/
├── src/                      Angular 22 client
│   ├── app/
│   │   ├── app.config.ts / app.routes.ts / app.component.*
│   │   ├── features/{auth,messages,upload,user}/
│   │   └── shared/{components,directives,functions,interfaces,pipes,services,types,utils,validators}/
│   └── environments/         environment.ts (PRODUCTION default) / environment.development.ts
├── libs/ui/<name>/           Spartan "helm" components (generated; each needs a tsconfig `paths` entry)
├── libs/contract/            type declarations
├── server/
│   ├── src/{auth,user,messenger,upload,websocket,processors,config,utils,error-handling,templates,scripts,test}/
│   ├── src/index.ts          API + WS entry
│   ├── src/worker.ts         media worker entry
│   └── scripts/smoke.sh      end-to-end smoke over HTTP (`npm run smoke`)
├── public/                   icons, PWA manifest, Inter variable fonts
├── capacitor.config.ts       mobile shell
├── CLAUDE.md, server/CLAUDE.md, src/app/CLAUDE.md   agent/contributor conventions
└── .mcp.json                 `angular`, `spartan-ng`, `spartan-ui`, `playwright` MCP servers
```

Note: the README's tree still lists a `features/calls/` directory — **it does not exist** in the repo.
There is no call/streaming feature.

---

## 4. Server request pipeline (`server/src/index.ts`)

Order matters and is documented inline in the file:

1. `GET /health-check` (before everything; logs on every hit)
2. `trust proxy` = `TRUSTED_PROXIES`; `cors` (origin = `CLIENT_URL`, credentials, allowed headers `Content-Type, Authorization, X-CSRF-Token`)
3. `setupWebSocket(server)` — attaches the `upgrade` handler (see §7)
4. `helmet` (CSP `'self'` + `unsafe-inline` for script/style, HSTS 1y preload), `compression`, `mongoSanitize`, `hpp`
5. `express.json` / `urlencoded` (1 MB limits), `cookie-parser`
6. **`identifyForRateLimit` → `generalLimiter` → `ensureCsrfCookie` → `csrfProtection`** — above *every* mount, `/auth` included. Never mount a router above this block.
7. Mounts: `/auth` (mixed public/authenticated) · `/user` (`authenticateToken`, **not** email-gated) · `/conversations`, `/messages`, `/notifications`, `/upload` (`authenticateToken` + `requireVerifiedEmail`)
8. JSON 404 (`code: NOT_FOUND`) then `errorMiddleware`

`start()` connects Mongo → Redis → `initLimiters()` → `registerInstance()` → subscribes `ws:broadcast`
and `ws:notification` → **then** `listen()`. `SIGTERM`/`SIGINT` shut down gracefully (15 s cap):
stop heartbeat, close sockets with 1001, quit Redis, disconnect Mongo. `unhandledRejection` is logged
and survived; `uncaughtException` logs and exits after 100 ms.

`connectDB` **refuses to start on a database named `test`** (the driver default for a path-less Atlas
URI). Set `MONGO_DB_NAME` or put the name in `MONGO_URI`.

`config/config.ts` is meant to be the only reader of `process.env` (the mailer, logger and test helpers
still read `SMTP_*`, `LOG_*`, `MONGO_TEST_URI` directly). In production it **throws at boot** if
`COOKIE_SECRET`, `COOKIE_DOMAIN`, `SESSION_SECRET`, `JWT_SECRET` or `JWT_REFRESH_SECRET` is missing.
`BCRYPT_ROUNDS` below 10 is ignored in production.

---

## 5. Uploads

### 5.1 Contexts (`server/src/upload/upload.types.ts`, `config/upload.config.ts`)

```ts
type UploadContext = 'avatar' | 'group-avatar' | 'cover-photo'
                   | 'dm-image' | 'dm-video' | 'dm-file' | 'dm-audio';
```

| Context | Max size | Allowed MIME types | Presign TTL | Final bucket | Handler |
|---|---|---|---|---|---|
| `avatar` | 20 MB | jpeg, png, webp, heic, heif | 5 min | public | `imageHandler` |
| `group-avatar` | 20 MB | same (requires `resourceId` = conversation you belong to) | 5 min | public | `imageHandler` |
| `cover-photo` | 20 MB | same | 5 min | public | `imageHandler` |
| `dm-image` | 50 MB | jpeg, png, webp, **gif**, heic, heif | 10 min | **private** | `dmImageHandler` |
| `dm-video` | 500 MB | mp4, quicktime, webm, x-msvideo, x-matroska | 30 min | private | `videoHandler` |
| `dm-audio` | 25 MB | webm, ogg, mp4, mpeg, wav | 10 min | private | `audioHandler` |
| `dm-file` | 100 MB | pdf, doc/docx, xls/xlsx, ppt/pptx, txt, csv, zip, 7z, rar | 10 min | private | `fileHandler` |

All raw uploads land first in the temp bucket. `post-*` / `story-*` contexts and their handlers were
**deleted** (they granted free storage to features that don't exist). Adding a context = the union in
`upload.types.ts` + an entry in `CONTEXT_CONFIG` + a handler in `processors/handlers/index.ts`
(+ extension in `EXTENSIONS` in `upload.controller.ts`).

### 5.2 Flow

```
1. POST /upload/presign {context, mimeType, fileSize, resourceId?}     (presignLimiter)
     validates context, MIME whitelist, size, and (group-avatar) conversation membership
     key = <context>/<userId>/<uploadId>/original.<ext>   (never the client filename)
     creates Upload{status:'pending', expiresAt = now+24h}; returns {uploadId, presignedUrl, fileKey, expiresIn}
2. Client PUTs the file straight to the presigned URL (ContentLength is part of the signature → send exact file.size)
3. POST /upload/confirm {uploadId}
     owner-only; must still be 'pending'; HeadObject on the temp bucket:
       404 → reject, 403 → accept (SeaweedFS quirk), other → 500
     status → 'processing'; enqueue BullMQ job 'process-upload' on queue 'media-processing'
4. Worker: [ClamAV scan if dm-file] → context handler → Upload{ready, variants, duration, expiresAt:null}
     → context side effect (onComplete) → emit `upload-ready` → delete temp original
5. Client updates the attachment in place from the `upload-ready` WS event
```

`Upload` (Mongo, `_id` = UUID string): `userId, context, resourceId, fileKey, mimeType, fileSize,
status (pending|processing|ready|failed|infected), variants (Mixed), duration, expiresAt`. A TTL index
on `expiresAt` (`expireAfterSeconds: 0`) reaps never-confirmed uploads after 24 h; the processor sets
`expiresAt: null` once the upload is referenced. The temp *object* is not removed by that TTL — rely on
bucket lifecycle / SeaweedFS admin scripts (§12).

Queue defaults (`config/queue.ts`): 3 attempts, exponential backoff from 5 s, completed jobs kept 1 h /
1000, failed jobs kept 24 h / 5000.

### 5.3 Variants actually produced

| Handler | Output (key under `<context>/<userId>/<uploadId>/`) | `variants` shape |
|---|---|---|
| `imageHandler` (avatar, group-avatar, cover-photo) | WebP at 64 / 400 / 1200 px (`withoutEnlargement`, EXIF-rotated, q80) → **public** bucket | `{thumb, medium, large}` |
| `dmImageHandler` | same function, **private** bucket. (The old note said 320/1280 px DM variants — that is **not** the case; DM images use the same 64/400/1200 set) | `{thumb, medium, large}` |
| `videoHandler` | one progressive **MP4** (libx264 crf 26, veryfast, ≤720p, aac 128k, `+faststart`, yuv420p) + a 640px-wide `thumb.webp` frame → **private** bucket. **No HLS** — HLS can't be served from a private bucket because playlist/segment sub-requests are unsigned | `{original, thumbnail}` + `duration` (rounded seconds) |
| `audioHandler` | **Ogg/Opus**, mono, 16 kHz, 32 kbps → private | `{original}` + `duration` (read from the finished .ogg, since MediaRecorder webm has no usable duration) |
| `fileHandler` | server-side copy temp → private, no processing | `{original}` |

Gotchas vs. the old note: the video poster key is **`thumbnail`** here (the old note said it was renamed
to `poster` — check how the client reads it, §10); `duration` lives on the attachment/`Upload`, not
inside `variants`; there is no `media-hls` bucket.

### 5.4 Side effects (`processors/handlers/side-effects.ts`)

| Context | `onComplete` |
|---|---|
| `avatar` | `User.pfp_url = variants.medium`, `User.pfp_variants = {thumb,medium,large}`; purge the user's superseded avatar uploads (objects + records) |
| `cover-photo` | `User.cover_url = variants.large`, `User.cover_variants = {thumb,medium,large}`; purge superseded |
| `group-avatar` | `Conversation.group_picture = medium`, `group_picture_variants = {…}`; writes an INFO message "<user> changed the group photo.", sets it as `last_message`, publishes it, emits `conversation-update` (fully populated) to all participants; purge superseded (scoped by conversation) |
| `dm-*` | sets `attachments.$.status='ready'`, `.variants`, `.duration` on the message holding that `uploadId`; emits `upload-ready` (signed variants) to every *other* participant |

(`onPostMediaComplete` still exists as an empty stub in `side-effects.ts` but nothing references it.)

### 5.5 Reading private media

Stored URLs are **unsigned** absolute URLs (`<S3_ENDPOINT>/<bucket>/<key>`); a signature is never
persisted. `upload/media-url.service.ts` signs on the way out: 6 h expiry, with the signing date rounded
down to the hour so the same object yields a byte-identical URL within that hour (browser caching).
`signMessage(s)`/`signAttachments`/`signVariants` are applied to message responses and to `upload-ready`
events. `GET /upload/signed-url/:uploadId` is the explicit endpoint (15 min expiry, participant check for
private contexts, owner check for public ones) — the client has `shared/services/signed-media.service.ts`
for it (§10).

### 5.6 Scan, quarantine, cleanup

- Only `dm-file` is ClamAV-scanned (`SCAN_CONTEXTS`), via `clamdscan` over TCP (`CLAMAV_HOST/PORT`,
  120 s timeout, no local fallback). Media is re-encoded, which destroys payloads.
- Infected: copied to the quarantine bucket with the dedicated `quarantine-writer` credentials
  (`quarantine/<uploadId>/<name>`, metadata lists viruses), temp copy deleted, `Upload.status='infected'`,
  attachment marked, `upload-infected` sent to the uploader (with virus names) and to other participants
  (without).
- Permanent failure (after 3 attempts): `Upload` and attachment → `failed`, temp original discarded,
  `upload-failed` pushed to the conversation.
- `upload/upload-cleanup.service.ts` `purgeUploads` / `purgeConversationUploads` delete the stored
  objects and records; used when a conversation is deleted, an account is deleted, and when a
  single-slot picture is superseded.
- Magic-byte (file signature) validation is **still not implemented**: the MIME type is trusted from the
  client at presign time. Mitigated for media by re-encoding and for `dm-file` by ClamAV, but not removed.

---

## 6. The media worker (`server/src/worker.ts`)

- Boots: configure ffmpeg (`ffmpeg-static`; **`ffprobe` must be on `PATH`** — both Dockerfiles `apt-get
  install ffmpeg`, and boot logs an error if it's missing) → `connectDB()` → `connectRedis()` → BullMQ
  `Worker('media-processing', processUpload)`.
- `WORKER_CONCURRENCY` (default 4; ffmpeg is CPU heavy — scale with replicas rather than concurrency),
  `lockDuration` 5 min, `lockRenewTime` 60 s.
- `failed` listener → `handleFailedJob`: only on the *final* attempt does it mark the upload/attachment
  `failed`, delete the temp original and emit `upload-failed`.
- It holds no sockets. Everything it pushes goes via Redis: `emitToUser` → `ws:upload`;
  `broadcastToParticipants` → `ws:broadcast` with `fromInstance: 'worker'` (never matches an API
  instance, so every API process delivers it). Worker code therefore imports **models, not services**
  (a service import would drag the WebSocket layer into the worker) — hence `LAST_MESSAGE_POPULATE` lives
  beside the Conversation schema.
- Has its own `unhandledRejection`/`uncaughtException` handlers that log and stay alive. A dead worker is
  silent: uploads keep being accepted and just sit at `processing`.

---

## 7. WebSocket

Same HTTP server and port as the API; `ws` with `noServer`, handshake in `websocket.setup.ts`.

**Handshake** (`verifyUpgradeRequest`): `Origin` must equal `CLIENT_URL` (a missing Origin is rejected —
CSWSH defence) → `accessToken` cookie → `verifyAccessToken` (type-scoped, so the 2FA challenge token
can't open a socket) → not in the Redis access-token blacklist → session not revoked (`isSessionRevoked`).
The socket records `userId`, `expiresAt` (token `exp`), `issuedAt`, `sid`. There is no post-connect
`authenticate` step: an inbound `authenticate` frame is ignored.

**Lifetime**: every 30 s a heartbeat pings, terminates sockets that missed a pong, and closes sockets
whose token has expired with **4001** (the client has refreshed its cookie by then and reconnects).
**4002** = session revoked; **1001** = server shutting down.

**Inbound (client → server)** — an *allowlist*, anything else is dropped: only `typing`,
`message-status`, `user-status`. Identity is re-stamped from the handshake on every frame
(`sender._id`, `read_receipt.user_id`, `user_id`). Messages are **not** sent over the socket: the client
`POST`s them, the server broadcasts.

**Per-type rate limit** (`ws-rate-limit.ts`, Redis Lua INCR+EXPIRE in one step, 10 s window, fails
open): `typing` 30, `message-status` 60, `user-status` 10, anything else 20. Over budget → a
`rate-limited` frame `{message_type, retry_after}`, at most once per window per type.

**Outbound (server → client)**

| Type | Meaning / source |
|---|---|
| `message` | new message (wrapped for any `MessageTypeEnum`); carries `tempId` back to the sender for optimistic-UI reconciliation |
| `message-edited` | `{conversation, message}` — text edited |
| `message-deleted` | `{conversation, message:{_id, deleted_at}}` — message became a tombstone |
| `message-status` | read receipt `{status:'read', read_receipt{…, read_at = server clock}, conversation_id}` |
| `typing` | `{is_typing, sender, conversation_id}`, membership-checked, not echoed to the sender |
| `user-status` | presence `{user_id, status, last_seen}`; only sent to people who share a conversation, and not at all if the user's privacy says nobody sees presence |
| `conversation-join` / `-leave` / `-update` | membership or metadata changed (server-originated only) |
| `notification` | `{conversationId, unread_count, seen}` via `ws:notification` |
| `upload-ready` / `upload-failed` / `upload-infected` | worker outcomes (§5) |
| `rate-limited` | see above |

**Fan-out is multi-instance.** Each API process has a `randomUUID()` `INSTANCE_ID`. Redis channels:

| Channel | Publisher → subscriber | Notes |
|---|---|---|
| `ws:broadcast` | API/worker → every API instance | `{participantIds, payload, fromInstance}`; an instance ignores its own id (it already delivered locally) |
| `ws:notification` | `notification.service` → API | subscribed in `index.ts` |
| `ws:upload` | worker → API | subscribed in `websocket.setup.ts` via `redisClient.duplicate()` |
| `ws:revoke` | `token.service` → every API instance | `{userId, sid}` closes one session's sockets; `{userId, at, keepSid}` closes everything issued before `at` |

Never use a bare `sendToUser` for anything leaving the local process: use `broadcast`, `sendToUsers`
(plain "these users, everywhere") or the `ws-emit` helpers.

**Presence**: sets `online_users` (global) and `online_users:<instance>` (per instance, TTL 90 s,
refreshed every 30 s so a crashed instance's users age out; `registerInstance()` reconciles the global set
from the live instance sets). A disconnect doesn't mark offline immediately — it adds the user to the
sorted set `offline_pending` with `now+30 s`; every instance runs a 5 s sweeper that claims due entries
with `ZREM` (exactly one winner), re-checks that the user is really gone, then writes
`User.status/last_seen` and broadcasts. Reconnecting cancels the pending entry. `last_seen` is always the
server clock.

Conversation participant ids used by `broadcast` are cached in Redis (`participantsCacheKey`, 1 h) and
invalidated whenever membership changes (`invalidateParticipantsCache`).

---

## 8. Messaging domain

### 8.1 Models

- **`Message`**: `sender`, `conversation`, `content?`, `type` (`info|text|image|video|audio|file`),
  `status` (`failed|sent|delivered|read`, default `sent`), `attachments[]` (max 10), `timestamp`,
  `edited_at?`, `deleted_at?`. Pre-validate requires text or attachments unless soft-deleted.
  Indexes: `{conversation, timestamp:-1}`, `{attachments.uploadId}`.
  Attachment: `uploadId, context (dm-image|dm-video|dm-audio|dm-file), mimeType, fileSize,
  status (processing|ready|failed|infected), variants (Mixed), duration?, originalName?`.
  Max text length **2000** (`MAX_MESSAGE_LENGTH`). The old note's `SENDING` status does not exist
  server-side.
- **`Conversation`**: `created_by?` (the group admin; DMs have none), `participants[]`, `last_message`,
  `read_receipts[{user_id, last_message_read_id, read_at}]`, `is_group`, `dm_key?`, `group_name?`,
  `group_picture?`, `group_picture_variants{thumb,medium,large}`, timestamps.
  **DM uniqueness is a scalar `dm_key`** (sorted participant ids joined by `:`) with a partial unique
  index — the old note's "unique index on `participants`" was replaced because a unique *multikey* index
  is per element and rejects the second DM of any user. Other index: `{participants, updatedAt:-1}`.
  Read receipts are maintained by `upsertReadReceipt` (one `arrayFilters` update + guarded push), not by
  a unique index.
- **`Notification`** `{user, conversation, unread_count, seen, seen_at?}`, unique `{user, conversation}`.
- **`MutedConversation`** `{user, conversation}` — a mute lasts until undone (no timed mute; the README's
  mention of `muted_until` is stale, the field was removed).
- **`Upload`** (§5).

### 8.2 Sending (REST) — `POST /messages/:id/send {content?, attachments[], tempId?}`

`validateConversation` proves membership → `createMessageWithAttachments`: length/attachment-count
checks → `assertNotBlocked` → every `uploadId` must be an `Upload` owned by the sender (mime/size are read
from the stored record, never the body) → message `type` derived from the **first** attachment's context
(`dm-image→image`, `dm-video→video`, `dm-audio→audio`, else `file`; none → `text`) → attachments saved
with `processing` status unless the upload is already `ready` → `last_message` updated → populated, URLs
signed → `broadcast` (to `deliverableParticipants`, excluding blockers in groups) with the `tempId` →
`createNotification` (fire-and-forget). Attachments therefore show a skeleton until the `upload-ready`
event arrives; late joiners just read the final state from the DB.
`createTextMessage` is the INFO/system path (also used for renames, joins, leaves).

Other routes (all `validateConversation`): `GET /:id/messages|media|files` (offset pagination,
`limit` default 20 / max 100; media = `dm-image`+`dm-video`, files = `dm-file`; messages from blocked
users are filtered out of every read), `PATCH|DELETE /:id/messages/:messageId` (author only; edit =
text only + `edited_at`, delete = **soft**: content/attachments cleared, `type` normalised to `text`,
`deleted_at` set; the row must survive because read receipts and `last_message` point at it).

### 8.3 Conversations — rules worth knowing

- Max **100** members. `created_by` is the group admin; only the admin can rename (name ≤ 100 chars),
  add/remove other members, or delete a group. Any member may remove *only themselves* (= leave).
  DMs can't be renamed or have members changed.
- Creating a DM when `dm_key` exists → 409. A block between creator and any invitee → 403.
  `group_picture` on create must be a URL under `S3_ENDPOINT` (or relative).
- Delete: broadcasts `conversation-leave`, purges every stored attachment object, deletes messages,
  notifications and mutes, invalidates the participant cache.
- Membership changes write INFO messages and emit `conversation-join` / `-leave` to the right audience
  (removed users are named explicitly because they're no longer participants).
- Search is capped at 50 results and regex-escapes the query (truncate first, then escape).

### 8.4 Unread counts / notifications

`unread_count` is **derived, never incremented**: messages in the conversation, not by the user, not
`info`, not deleted, newer than `max(last-read message timestamp, notification.seen_at)`, capped at 99.
It's recomputed on each new message (`createNotification`), each read receipt (`recomputeNotification`),
unmute, join (a watermark is seeded so history isn't "unread"), and on every `GET /notifications`
(`refreshNotificationsForUser` — a single aggregation, also deletes orphaned rows and skips muted ones).
Muting zeroes the badge without touching `seen_at`.

### 8.5 Blocking

One-directional data, bidirectional effect (`blockedAmong`, `isBlockedEitherWay` in
`user/services/blocking.service.ts`). DM: sending is refused (403). Group: the message is still stored but
`deliverableParticipants` drops blockers from delivery and read queries hide the sender. INFO messages
are exempt. Also enforced on conversation creation, adding to groups, DM lookup (404), user search/list,
profile fetch.

---

## 9. Authentication and sessions

### 9.1 Tokens and cookies

| Cookie | Contents | Attributes |
|---|---|---|
| `accessToken` | JWT `{userId, sid, typ:'access'}` signed with `JWT_SECRET`, `JWT_EXPIRES_IN` (1 h) | httpOnly; `maxAge` = the token's own remaining life |
| `refreshToken` | JWT `typ:'refresh'`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` (7 d) | httpOnly; **`path=/auth/refresh`** (invisible to every other endpoint) |
| `csrfToken` | random 32-byte hex | **not** httpOnly; `domain=COOKIE_DOMAIN`; 24 h (deliberately outlives the access token) |
| `twoFactorChallenge` | JWT `typ:'two-factor-challenge'` (token valid 5 min), cookie 10 min | httpOnly |
| `oidcTx` | `{provider, state, verifier, nonce?, intent, userId?}` | httpOnly, **`SameSite=Lax`**, `path=/auth/oidc`, 10 min; unsigned, so never trusted to pick an account |

All httpOnly cookies are `secure` + `SameSite=None` in production and `lax` in dev. Every token carries
`typ` and verification is **type-scoped** (a 2FA challenge can't be used as an access token, and
untyped legacy tokens are rejected). `sid` is a per-login session id that survives refresh rotation.

### 9.2 Session state (all in Redis, `auth/services/token.service.ts`)

- Refresh tokens are stored as SHA-256 hashes: `refresh:{userId}:<hash>` → JSON `SessionMeta
  {sid, userAgent, ip, createdAt, lastUsedAt}` (TTL 7 d) plus the member set `refresh:set:{userId}`. The
  `{userId}` hash tag keeps every key in one Redis-Cluster slot so MULTI/Lua are legal.
- **Rotation is atomic (Lua)**; presenting an already-rotated token is treated as **reuse** and wipes
  the user's whole token family (`401 Token reuse detected`).
- Revocation has two halves, always applied together: delete refresh entries *and* refuse access
  tokens already in browsers. `revokeSession(userId,sid)` → key `revoked:sid:{userId}:<sid>`;
  `revokeSessionsBefore(userId, keepSid?)` → epoch key `revoked:{userId}` (compared with `iat`, whole
  seconds, strict `<`; TTL = access-token lifetime + 60 s). Both publish `ws:revoke`, so open sockets
  close with 4002. `isSessionRevoked` **fails open** on Redis errors (an outage would otherwise sign
  everyone out). Logout blacklists the access token (`blacklist:<hash>`) for its remaining TTL.
- Sessions list reports only what the server observed: user agent, IP, created/last-used times (no
  geolocation).

### 9.3 Flows

- **Register**: validators (`email`, username 3–32 `[A-Za-z0-9._-]`, names ≤ 64, shared `passwordRule`) →
  `registerLimiter` → duplicate check with case-insensitive collation (409 `DUPLICATE`) → HIBP check →
  save → fire-and-forget verification email. Email is normalised **only** by `normalizeEmail`
  (trim + lowercase; express-validator's `normalizeEmail()` is deliberately not used).
- **Login**: `loginLimiter` (5 tries/15 min, keyed email+IP, escalating cooldowns) → generic
  `401 Invalid credentials` for unknown user or bad password → per-account lockout after **10** failures
  (30 min, `423`, emails unlock + reset links; sessions are not revoked) → if a second factor is enrolled,
  returns `{two_factor_required, methods, default_method}` and sets `twoFactorChallenge`, otherwise
  `issueSession` (new `sid`, tokens, cookies, clears attempts).
- **Second factor** (`POST /auth/login/2fa`): accepts a TOTP code (consumed to block replay), an emailed
  code, or a recovery code (burned on use). If only the email factor is enrolled, the code is mailed
  automatically at step 1.
  - TOTP: own RFC 6238 implementation, SHA-1, 6 digits, 30 s, ±1 step drift, used codes remembered.
  - Email OTP: Redis, hashed, 6 digits, 10 min TTL, 60 s resend gap, 5 guesses per code, single use.
  - Recovery codes: 8 per enrolment, `XXXXX-XXXXX` over an unambiguous alphabet, stored as SHA-256 of the
    canonicalised code (dash/case/space-insensitive; legacy hashes still match). Shared by both factors.
  - One `two_factor_auth` document per user holds both factors (`two_factor_enabled` means **TOTP**).
- **Account links** (`generateLink`, `account_tokens` collection): types `password_reset`,
  `email_verification`, `unlock_account`, `email_change`; random UUID emailed, only the SHA-256 stored,
  1 h expiry, one live token per user+type. Links point at `CLIENT_URL/auth/<action>?token=…&id=…`.
- **Change password** (needs current password; `changePasswordLimiter`) revokes every *other* session
  (`keepSid`). **Change email** stores `pending_email`, mails the *new* address, confirmed via
  `/auth/confirm-email` (works from another browser; cancel via `/auth/cancel-email-change`).
- **Email verification gate**: `REQUIRE_EMAIL_VERIFICATION` is **off by default** (turning it on without
  `npm run backfill:verified` locks out every pre-existing account). When on, `requireVerifiedEmail`
  returns `403 {code:'EMAIL_NOT_VERIFIED'}` on `/conversations`, `/messages`, `/notifications`, `/upload`.
- **Logout** is deliberately unauthenticated (must work with an expired access token) but CSRF-protected.

### 9.4 Google / GitHub sign-in (`auth/services/oidc.service.ts`)

Provider registry keyed `google` | `github`. A provider is enabled only when `*_CLIENT_ID`,
`*_CLIENT_SECRET` and `*_REDIRECT_URI` are all set; `GET /auth/oidc/providers` lists the enabled ones
and the client renders buttons only for those. Google is OpenID Connect (discovery, ID token, nonce,
`prompt=select_account`); GitHub is plain OAuth 2.0 — hand-written endpoints, no ID token, profile from
`GET /user` (`sub` = numeric `id`, which survives a rename) and the address from `GET /user/emails`
(scope `user:email`) via `pickGithubEmail`. Both use PKCE S256.

- `GET /auth/oidc/:provider/start` → sets `oidcTx`, 302 to the provider. `GET …/callback` → checks the
  tx exists and names the same provider (mix-up defence), exchanges the code against a URL rebuilt on
  the *configured* redirect URI (`callbackUrl`; openid-client re-sends it query-stripped as
  `redirect_uri`), then `resolveOidcUser`:
  1. the account holding `{provider: issuer, sub}` → sign in;
  2. else requires a verified provider address; a local account with it is **auto-linked** only if its
     own address is verified (`link_required` otherwise; `provider_in_use` if it already holds a
     different identity there), and its owner gets the `identity-change-email` alert;
  3. else creates a verified, password-less account (names fall back to the GitHub login, then the
     address's local part; a lost create race resolves to the winner's account).
- Then 2FA is honoured (`/auth/login?two_factor=1&methods=…&default=…`, the SPA resumes the code step)
  or a normal session is issued and the browser goes to `CLIENT_URL/auth/oidc/callback`, an SPA page
  that loads the user before calling the app signed in. Errors: `CLIENT_URL/auth/login?error=<code>`
  (`oidc_expired`, `oidc_cancelled`, `oidc_failed`, `oidc_unavailable`, `email_unverified`,
  `link_required`, `provider_in_use`, `rate_limited`).
- **Connected accounts** (Settings → Security): `POST /auth/oidc/:provider/link` (password, CSRF) returns
  the provider URL; the callback attaches the identity to the **live session's** user (and requires the
  tx's `userId` to agree — the cookie alone never picks the account). `DELETE /auth/identities/:provider`
  (password). Both share `changePasswordLimiter` and send the alert email. At most one identity per
  provider per account; the `identities_unique` index settles two accounts racing for one identity.
- **Password-less accounts**: `assertPassword`, change-password, change-email and delete-account answer
  400 "…Set one from Settings → Security first." instead of "wrong password"; the screen sends the
  forgot-password link, whose mail reads "Set a password" for such accounts. `/user/profile` exposes
  `has_password` and `providers` (names only — never the hash or `sub`).

### 9.5 Rate limiting (`auth/middlewares/rate-limiter.ts`)

Global (express-rate-limit + `RedisStore`, built in `initLimiters()`, fail open until Redis is up):
`generalLimiter` 5-min window — **1000 requests signed-in / 300 anonymous** (the old note's "100/5 min"
is out of date); `presignLimiter` 1-min window — **120 signed-in / 30 anonymous**. Keyed by
`u:<userId>` (from `identifyForRateLimit`, which verifies the token signature but ignores expiry so
`/auth/refresh` gets a per-user bucket) or by IP (IPv6 collapsed to /56).

Per-identity escalating limiters (`createRateLimiter`: counts on entry, a cooldown clears the tally and
bumps a round counter, `resetRateLimit` on success; **fails open** when Redis is down):

| Limiter | Allowance / window | Cooldowns | Key |
|---|---|---|---|
| `loginLimiter` | 5 / 15 min | 5 m, 15 m, 1 h | email+IP |
| `registerLimiter` | 5 / 1 h (never reset) | 30 m, 3 h | IP |
| `forgotPasswordLimiter` | 3 / 1 h | 15 m, 1 h | target email |
| `resetPasswordLimiter` (+ confirm-email) | 10 / 15 min | 15 m, 1 h | userId/id+IP |
| `accountTokenLimiter` (verify-email, unlock) | 10 / 15 min | 15 m, 1 h | userId/id+IP |
| `resendVerificationLimiter` | 3 / 1 h | 30 m | user |
| `changePasswordLimiter` (+ change-email) | 5 / 15 min | 15 m, 1 h | user |
| `twoFactorCodeLimiter` | 5 / 15 min | 15 m, 1 h | user / challenge cookie / IP |
| `twoFactorEmailSendLimiter` | 10 / 1 h | 15 m, 1 h | user / challenge / IP |
| `twoFactorSetupLimiter` | 10 / 1 h | 15 m | user |
| `oidcStartLimiter` / `oidcCallbackLimiter` | 20 / 15 min · 10 / 15 min | 5–15 m · 5 m–1 h | IP; **redirect** to `/auth/login?error=rate_limited` instead of JSON |

Rule of thumb from the code: limiters that ration *volume* sit **after** validation; limiters that
ration *guessing* sit **first**. Sending a code and guessing a code use different limiters. A 429 body is
`{message, code:'RATE_LIMITED', retryAfter}` plus `Retry-After`.

### 9.6 CSRF

Double-submit cookie. `ensureCsrfCookie` mints `csrfToken` on any safe request that lacks one;
`csrfProtection` requires cookie === `X-CSRF-Token` header (timing-safe) on every non-GET/HEAD/OPTIONS
request, else `403 {code:'CSRF'}`. `GET /auth/csrf` returns a token for the pre-login phase. Presigned
S3 `PUT`s must **not** carry the header or credentials (breaks the signature / CORS).

---

## 10. Users, privacy, blocking, account deletion

- **`User`** fields: `first_name, last_name, username (case-insensitive unique via collation index
  username_ci_unique), bio, email (unique, lowercase), pending_email, password (select:false, bcrypt
  BCRYPT_ROUNDS, validated by the shared policy), is_email_verified, login_attempts, lock_until,
  last_login, identities[], pfp_url + pfp_variants{thumb,medium,large}, cover_url + cover_variants
  {thumb,medium,large}, status (offline|online|away), last_seen, blocked_users[], privacy{last_seen,
  pfp_url, bio, online_status: everyone|contacts|nobody}`. Text index on names/username.
  "Contacts" = people you share a conversation with (there is no friend list).
- **Redaction on the way out** (`redactForViewer`): hides `last_seen`, pfp, bio per setting; hidden
  presence reads as `offline`; `privacy` itself is only visible to the owner. `online_status: nobody`
  also stops `user-status` broadcasts. Public fields are an explicit allowlist (`PUBLIC_USER_FIELDS`).
- **Routes**: `/user/profile` (GET/PATCH/DELETE — delete requires the password), `/user` and
  `/user/search` (capped at 50, block-filtered), `/user/privacy`, `/user/blocked`,
  `/user/:id/block`, `/user/storage` (real per-category byte totals from `Upload`), `/user/export`
  (JSON download), `/user/:id` (404 if either side blocked the other).
- **Account deletion** (`deleteAccount`): purge all uploads (objects + records), tombstone the user's
  messages, delete conversations left with < 2 members, pull the user from the rest (and their read
  receipts), hand a group's `created_by` to a remaining member, drop notifications/mutes/2FA/account
  tokens/refresh tokens/email codes, remove the user from everyone's `blocked_users`, delete the user.
- **Password policy** (`auth/services/password-policy.ts`, mirrored client-side): min 8 / max 128, no
  composition rules, blocklist + `looksTrivial` + context checks (username/email), plus HIBP k-anonymity
  lookup (`CHECK_BREACHED_PASSWORDS`, 2.5 s timeout, fails open with a breaker). See `CLAUDE.md`.

---

## 11. Angular client (`src/app`)

### 11.1 Bootstrap (`app.config.ts`, `main.ts`)

Zoneless (`provideZonelessChangeDetection`), router with view transitions (a `data-vt` depth attribute
drives CSS transitions; skipped beyond depth 2) and scroll restoration, `provideHttpClient` with
**`httpOptionsInterceptor` then `authInterceptor`**, `ngx-loading-bar` on the router, and an app
initializer that fetches the CSRF token (`GET /auth/csrf`) *before* anything renders, then calls
`AuthService.init()`. `main.ts` also cancels iOS pinch-zoom gestures. No `withXsrfConfiguration` — the
interceptor sets `X-CSRF-TOKEN` explicitly because every request is cross-origin absolute.

### 11.2 Routes (`app.routes.ts`)

| Path | Guard | Notes |
|---|---|---|
| `''` | — | redirects to `/auth` → `/auth/login` |
| `/auth/login`, `/auth/register` | `unauthenticatedGuard` | the only pages meaningless with a session |
| `/auth/forgot-password`, `reset-password`, `unlock-account`, `verify-email`, `confirm-email` | none | redeem email links; usable while signed in |
| `/settings/{profile,account,appearance,notifications,privacy,security,data-storage,help-support}` | `authGuard` | `UserSettingsLayout` shell, lazy |
| `/messages`, `/messages/new`, `/messages/:id` | `authGuard` | `MessagesLayoutComponent`; `conversationsResolver` always returns (cached list + background revalidate, `of(null)` on failure so a failed fetch can't blank the page) |
| `/u/:id` | `authGuard` | user profile page (namespaced so typos reach the 404) |
| `**` | — | `NotFoundPage` |

`authGuard` returns a `UrlTree` to `/auth/login?returnUrl=…`, and `AuthService.completeLogin` honours it.

### 11.3 State and service scope

- `providedIn: 'root'`: `AuthService`, `CSRFService`, `UserService`, `UserStateService`,
  `WebSocketService`, `NotificationService` (declared with the new `@Service()` decorator),
  `UploadService`, `SignedMediaService`, `ThemeService`, `MediaViewerService`, settings services.
- **Route-scoped to `/messages`** (provided in `app.routes.ts`, destroyed on leaving): `MessageService`,
  `ConversationService`, `MessageActionsService`; and `LayoutService` on the messages child route. Don't
  "fix" this with `providedIn: 'root'` — and note `AuthService` injects `NotificationService` but not
  these.
- Everything is signals; `httpResource` for message pages; `linkedSignal` for the merged lists.
- `AuthService`: `isAuthenticated` is a signal seeded from `localStorage['isAuthenticated']`;
  `init()` loads `/user/profile` (one retry unless 401), opens the socket, announces presence, seeds
  notifications. 401 → `authInterceptor` runs a single shared `refreshToken()`, then replays the request
  with the *new* CSRF cookie; a refresh that fails with 401 (or "reuse detected") calls
  `handleAuthFailure()` (server logout best-effort, clear state, close socket, go to login).
  `httpOptionsInterceptor` also replays once after a `403 CSRF`, toasts on 429, and flags
  `EMAIL_NOT_VERIFIED` into `UserStateService`.
- `WebSocketService`: rxjs `webSocket` to `wsUrl`, infinite capped-exponential reconnect with jitter
  (1 s → 15 s), immediate retry on `online`/`visibilitychange`, `shouldBeConnected` flag so logout can't
  resurrect it, `connected` signal, `onReconnect()` (re-announce presence, refetch newest page),
  per-type latest-frame memory so `message-status`/`user-status` frames dropped by the server's rate
  limiter are replayed after `retry_after`.

### 11.4 Messaging UI

- `MessagesLayoutComponent` + `ConversationListComponent` (sidebar/list, search, unread badges) +
  `ChatboxComponent` (thread, composer, header; 1.3k lines) + `ChatboxSettingsComponent` (group
  rename, avatar crop+upload, members via `ItemManager`, media/files tabs via `MediaFilesList`) +
  `NewChatComponent` (user search → group or DM) + `MessageCardComponent` + `MessageActionsComponent`.
  Mobile (≤ 640 px) uses `LayoutService.activeView` (`lists | chatbox | chatbox-settings`); swipe gestures
  via `PanGestureDirective` (a deliberate `@HostListener` exception — it needs non-passive `touchmove`).
- **Lazy DM creation**: choosing a user in `NewChat` stores `sessionStorage['selectedUser']` and routes to
  `/messages/<userId>`; `createMockConversation()` makes a placeholder (no `createdAt`). The conversation
  is only `POST`ed (`{conversation:{participants,is_group,group_name}}`) when the first message is sent
  (`ensureConversation`), then the route is replaced with the real id.
- **Send path** (`ChatboxComponent.sendMessage`): trim, ≤ 2000 chars, 300 ms spam guard, no uploading
  or errored chips → build an *optimistic* message (`tempId`, `MessageStatus.SENDING`, attachments marked
  `processing`) → `messageService.sendMessage` (REST) → `fillInMessageDetails` reconciles by `tempId`
  or `_id` (idempotent regardless of whether the WS echo or the HTTP reply lands first); failure marks the
  bubble `FAILED` and toasts the server's reason. Voice notes: `AudioRecorder` → `dm-audio` upload →
  send. Paste-to-attach is supported (`@HostListener('paste')`).
- Thread data: `MessageService` holds three `MessageList`s (messages/media/files), newest-first, merged
  by `_id ?? tempId`, offset-paginated (limit 20, 40 on tall viewports), an `IntersectionObserver` on a
  top sentinel loads older pages. Every mutator (`updateAttachmentVariants`, `markAttachmentInfected/Failed`,
  `applyEdited`, `applyDeleted`) updates all three lists; `pendingVariants` covers the case where
  `upload-ready` arrives before the HTTP reply.
- Message rendering (`message-card`): text; image grid (up to 4, `+N` overflow); video poster →
  lazy `VideoPlayer`; audio → `AudioPlayer`; file → `FileViewer`; `info` → centered muted line;
  tombstone for `deleted_at`; processing/failed/infected placeholders (`AttachmentPlaceholder`);
  edit/delete/copy via dropdown (pointer) or long-press action sheet (touch).
- Unread/read: the chatbox sends a `message-status` frame for the newest incoming message that is on
  screen and the tab is visible; `NotificationService` upserts server `notification` events and
  **never raises a badge for the conversation currently open and visible**.
- Handled WS events in the chatbox: `message`, `message-edited`, `message-deleted`,
  `conversation-update|join|leave` (leave only removes the conversation locally if *you* were removed),
  `upload-ready` (a `group-avatar` result calls `applyGroupPicture`), `upload-infected`, `upload-failed`;
  typing/presence/receipts via signals+effects in the same file.

### 11.5 Upload UI

- `UploadService.uploadFile(context, file, resourceId?)` = presign → `PUT` to the presigned URL with
  `reportProgress` (headers: only `Content-Type`) → `take(1)` on 100 % → confirm. Tracks per-upload
  state (`uploading|confirming|done|error`) in a signal map; errors are mapped through `apiErrorMessage`.
- `FilePicker` (`app-file-picker`, content-projection wrapper, no template of its own): inputs
  `config`, `remainingSlots`, `contextResolver`, `accept` (a host veto *before* the upload starts);
  outputs `fileSelected`, `fileReady`, `fileError`, `cleared`. Validates MIME/size client-side with
  `MAX_SIZE_MB` and `defaultAllowed` (mirrors `CONTEXT_CONFIG`; keep in sync). `PendingAttachment`
  = `{tempId, file, fileKey(=uploadId), previewUrl, context, uploading, error}`.
- Context auto-resolution in the chatbox: `image/*→dm-image`, `video/*→dm-video`, `audio/*→dm-audio`,
  else `dm-file`. Max 10 attachments, duplicate = same name+size.
- Avatar: profile settings uses `ngx-smart-cropper` → `UserService.uploadProfilePicture` → `avatar` context; the
  `upload-ready` handler in `AuthService.init` applies `variants.medium`. Group avatar: chatbox settings
  crop → `ChatboxSettingsService` → `group-avatar` with the conversation id as `resourceId`, shown
  optimistically (`pendingGroupPicture`) until the worker's result arrives. **`cover-photo` has no client
  UI.**
- Presigned PUTs are not sent to `apiUrl`, so `httpOptionsInterceptor` skips them (no cookies, no CSRF
  header); the SeaweedFS bucket therefore needs CORS permitting the app origin.

### 11.6 Media components (`shared/components`)

`VideoPlayer` (custom controls; poster = `variants.thumbnail || thumb`; src = `variants.original`;
detects missing HTTP Range support and warns because Chromium won't seek without `206`; on a media error
asks `SignedMediaService.refresh(uploadId)` for freshly signed URLs and retries), `AudioPlayer`
(src = `variants.original`, duration = `attachment.duration`; same re-sign recovery),
`AudioRecorder` (MediaRecorder with codec fallback, live level bars, state held in a signal),
`MediaViewer` (CDK `Dialog` full-screen gallery via `MediaViewerService.openGallery`, thumbnails, download),
`FileViewer`, `AttachmentPlaceholder`, `ItemManager` (search-and-pick modal used for adding/removing
group members), `NotFoundPage`.
`FileI` no longer exists; everything takes `AttachmentI`. `HlmAttachment*` (Spartan) renders chips.
`MediaItem.url` is a full (signed) URL — nothing is prefixed with `apiUrl`.

### 11.7 Settings screens

`profile` (names, bio, username, avatar), `account` (email change + pending banner, password change,
account deletion with password), `appearance` (light/dark/system + colour theme, persisted in
`localStorage['theme'|'colorTheme']`, View-Transition animated), `notifications` (per-conversation
mute toggles — the only notification preference the server has), `privacy`
(4 visibility selects + blocked users list), `security` (TOTP + email 2FA enrol/disable, QR code from
`shared/utils/qr-code.ts`, recovery codes, live session list with revoke / revoke-others),
`data-storage` (real per-category usage from `/user/storage`, JSON export), `help-support`
(rows render only when `environment.supportEmail/termsUrl/privacyUrl/appVersion` are non-empty — all
currently empty).

### 11.8 Shared helpers

`apiErrorMessage` / `apiFieldErrors` (`shared/functions/api-error.ts`; the only way errors should be
turned into text — handles `{message}`, `{error}`, `{errors[]}`, non-JSON, network failures),
`form.utils` (map server field errors onto controls), `base64-to-file`, pipes (`timeAgo`, `fileSize`,
`fileType`, `formatTime`), validators (`password.validator` — mirror of the server policy,
`repeat-password`, `no-only-whitespace`), `pseudo-waveform`, directives (`click-outside`, `long-press`,
`pan`).

### 11.9 UI kit

`libs/ui/*` = generated Spartan "helm" components: alert, attachment, avatar, badge, button, card,
collapsible, dropdown-menu, field, hover-card, icon, input, input-otp, item, label, progress,
scroll-area, separator, sheet, sidebar, skeleton, sonner, spinner, tabs, textarea, tooltip, utils.
Adding one needs the generated directory **and** a `tsconfig.json` `paths` entry. `@chat-app/contract`
(`libs/contract/src/index.d.ts`) is the tiny client↔server shared type package (`MemberChangesI`);
`server/Dockerfile` copies `libs/` for it. Tailwind v4 + `class-variance-authority` + `tailwind-merge`;
icons from `@ng-icons/lucide`; fonts: self-hosted Inter variable.

---

## 12. Infrastructure and deployment

**Not verifiable from the repo — carried over from the previous note; confirm against the live
deployment before relying on it:** Coolify (self-hosted) behind Cloudflare Tunnel + Traefik;
services `frontend`, `backend`, `worker`, `seaweedfs` (master+filer+volume+S3 in one container, plus an
admin container running `weed admin` whose scheduled scripts include `s3.clean.uploads -timeAgo=24h`),
`clamav` (`clamav/clamav:stable`, definitions on a volume), `redis`. Deployed hosts are in
`src/environments/environment.ts` (`api-chat-app.zura156.xyz`, `s3.zura156.xyz`) and in the CSP in
`security-headers.conf`.

Build artefacts that *are* in the repo:

| Image | Dockerfile | Notes |
|---|---|---|
| frontend | `Dockerfile` | `node:24-alpine` → `npm ci` → `npm run build -- --configuration=production` → `nginx:alpine`; SPA fallback to `index.html`; `index.html` is `no-cache`, hashed assets are immutable 1 y; `security-headers.conf` is included in every location |
| backend | `server/Dockerfile` | build context is the **repo root** (copies `libs/` + `server/`); `node:22-bookworm-slim`, `ffmpeg`, `tini`, `curl`; `npm run build` then `npm prune --omit=dev`; `CMD npm start` → `node dist/src/index.js`; `EXPOSE 3000` |
| worker | `server/Dockerfile.worker` | same base; `CMD npm run worker:prod` → `node dist/src/worker.js`; no port |

(The old note showed single-folder Dockerfiles with `COPY package*.json` — those are gone.)

Frontend security headers (nginx): CSP `default-src 'self'`; `script-src 'self' static.cloudflareinsights.com`;
`connect-src` limited to the API (https+wss), S3 and Cloudflare insights; `img-src`/`media-src`
`https: blob: data:`; `frame-ancestors 'none'`; `X-Frame-Options DENY`; `nosniff`; `Referrer-Policy
strict-origin-when-cross-origin`; `Permissions-Policy microphone=(self), camera=(), geolocation=()`;
COOP `same-origin`. **The API/S3 origins are hard-coded in this file** — change them with the deployment.

### SeaweedFS notes (from the previous note, still relevant to `config/s3.ts`)

- Path-style addressing, dummy region, `requestChecksumCalculation/responseChecksumValidation:
  'WHEN_REQUIRED'` — all SeaweedFS accommodations.
- Each S3 bucket is its own collection and needs its own volumes; after a restart pre-grow them
  (`curl "http://<master>:9333/vol/grow?collection=<bucket>&count=3"` for `uploads-temp`, `media-public`,
  `media-private`, `media-quarantine`; `media-hls` is no longer used by the code). Start command used:
  `weed server -dir=/data -master.port=9333 -volume.max=50 -s3 -s3.port=8333 -s3.config=/config.json`
  (the config lives in the master container).
- Identities: an admin identity, an `app` identity (Read/ReadAcp/Write/List) used as `S3_APP_*`, a
  `quarantine-writer` (Write/List only) used as `S3_QUARANTINE_*`, and an `anonymous` identity.
  **Check what `anonymous` is allowed to read.** The previous note granted it `Read` globally; if that is
  still true for `media-private` and `uploads-temp`, private attachments are readable without a
  signature and the signed-URL machinery protects nothing. A quick test: `curl -I` an *unsigned* private
  object URL — it must be 403.
- Past incident (previous note): files in `uploads-temp` "disappeared" because the worker could not reach
  Mongo/Redis, BullMQ retried, and cleanup raced it. The worker now connects both before consuming.
- `HeadObject` on SeaweedFS can return 403 (not 404) for an existing object; `confirm` treats only 404
  as "missing".
- `ContentLength` is signed into the presigned PUT, so the client must send exactly `file.size`.

---

## 13. Environment variables

Authoritative source is `server/src/config/config.ts` (plus `utils/mailer.ts`, `utils/logger.ts`,
`tests/env.ts`). Names only — **never put values in docs**.

| Group | Variables |
|---|---|
| Server | `PORT` (3000), `NODE_ENV`, `CLIENT_URL` (CORS + WS Origin check + email link base), `TRUSTED_PROXIES` (comma list) |
| Data | `MONGO_URI`, `MONGO_DB_NAME` (server refuses the db name `test`), `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` |
| Secrets (throw at boot in production) | `COOKIE_SECRET`, `SESSION_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_DOMAIN` |
| Tokens | `JWT_EXPIRES_IN` (1h), `JWT_REFRESH_EXPIRES_IN` (7d) |
| Auth behaviour | `REQUIRE_EMAIL_VERIFICATION` (false), `CHECK_BREACHED_PASSWORDS` (true), `BCRYPT_ROUNDS` (10; 4–15, ≥ 10 in prod), `TWO_FACTOR_ISSUER` (chat-app) |
| Google / GitHub sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI` (redirects into the existing `CLIENT_URL`) |
| Storage | `S3_ENDPOINT`, `S3_APP_ACCESS`, `S3_APP_SECRET`, `S3_QUARANTINE_ACCESS`, `S3_QUARANTINE_SECRET`, `S3_BUCKET_PUBLIC`, `S3_BUCKET_PRIVATE`, `S3_BUCKET_QUARANTINE`, `S3_BUCKET_TEMP` (**`S3_BUCKET_HLS` is gone**) |
| Scanning | `CLAMAV_HOST` (localhost), `CLAMAV_PORT` (3310) |
| Worker | `WORKER_CONCURRENCY` (4) |
| Mail | `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` |
| Logging | `LOG_LEVEL`, `LOG_DIR` (`<cwd>/logs`), `LOG_SILENT` |
| Tests | `MONGO_TEST_URI`, `REDIS_TEST_URL`, `REQUIRE_INTEGRATION` |
| Removed | `WS_PORT` (WS shares `PORT`), `S3_BUCKET_HLS`, `RECAPTCHA_SECRET_KEY` (never read by any code) |

Client: `src/environments/environment.ts` (**production defaults**) / `environment.development.ts`
(selected by `fileReplacements` for `ng serve`): `apiUrl`, `wsUrl`, `s3Url`, `recaptchaSiteKey`
(present but **unused** — no code renders or verifies a reCAPTCHA), `supportEmail`, `termsUrl`,
`privacyUrl`, `appVersion`.

---

## 14. Testing and tooling

- **Client**: 25 spec files, Vitest in jsdom through `ng test` (`@angular/build:unit-test`); the root
  `vitest.config.ts` throws on purpose. **Server**: 26 spec files under `server/src/tests/`, mirroring
  the module tree — unit (`*.spec.ts`) and integration (`*.int.spec.ts`, need Mongo + Redis, use `describeIntegration`/`describeRedisIntegration`, skip
  themselves when the services are down; `REQUIRE_INTEGRATION=1` makes that a failure). Global setup
  pins `CHECK_BREACHED_PASSWORDS=false`, `LOG_SILENT=1`, `BCRYPT_ROUNDS=4`.
- `server/scripts/smoke.sh` (`npm run smoke`) drives a running API over HTTP with cookies, CSRF and the
  limiters in the way; use `localhost` (the CSRF cookie's domain) and flush Redis between runs.
- `server/src/scripts/` maintenance tasks (run with `ts-node`): `backfill:notifications`,
  `backfill:verified`, `dedupe:notifications`, `diagnose:notifications` (read-only), `strip:deleted`
  (`--dry`). Several mutate production data.
- Dev tooling: `.mcp.json` registers `angular`, `spartan-ng`, `spartan-ui` (duplicate of `spartan-ng`)
  and `playwright` MCP servers; `.claude/skills/angular-developer` and `.agents/skills/spartan` hold
  version-specific guidance. There is no lint target on either side; `npm run typecheck` is the only way
  specs get type-checked.

---

## 15. Open items, risks and documentation drift

Ordered roughly by how much they matter. "Verified" = confirmed in code this pass.

### Security / correctness

1. **Magic-byte validation is still missing** (carried over from the old note). The MIME type comes from
   the client at presign time and is checked only against the whitelist. Media is neutralised by
   re-encoding and `dm-file` is ClamAV-scanned, but a mislabelled file is still accepted into the temp
   bucket. A signature check (e.g. `file-type`) belongs in the worker before the handler runs.
2. **Check SeaweedFS `anonymous` permissions** (§12). If it still has global `Read`, the private bucket's
   signed URLs are decorative. Unverifiable from the repo.
3. **Google/GitHub sign-in is covered by specs but not yet run against the real providers.**
   `oidc.service.spec.ts` / `oidc.service.int.spec.ts` and the login, buttons, callback and security
   specs cover everything short of the live round trip; that needs OAuth clients registered in both
   consoles (README → "Setting up Google and GitHub sign-in").
4. `account_tokens` has no TTL index on `expires_at` (verified) — expired tokens are rejected on use but
   never reaped.
5. Uploads: a `pending` `Upload` record is reaped after 24 h by its TTL index, but its **temp object is
   not** — that relies on SeaweedFS lifecycle/`s3.clean.uploads`. The old "stale upload cleanup cron" item
   is therefore half done (record yes, object no).
6. A `dm-*` attachment leaves `processing` only through the worker's `upload-ready` / `-failed` /
   `-infected` events (or being already `ready` when the message is sent); a worker outage leaves it
   spinning in every client, and there is no timeout or retry sweep on the API side.
7. Fail-open choices to remember: general/presign limiters before Redis is ready, every per-identity
   limiter on Redis errors, the HIBP check, `isSessionRevoked`, and the WS rate limiter. Each is
   deliberate and commented; none is a bug, but together they mean a Redis outage removes most abuse
   controls.

### Product gaps

- `cover-photo`: server pipeline + `User.cover_url/cover_variants` exist, no client UI.
- No push/browser notifications, no timed mute, no message-body search (only conversation/user search),
  no reactions/replies/forwarding (the `Message` model has no fields for them), no group ownership
  transfer (deleting the admin's account auto-promotes an arbitrary member).
- Posts, stories and live streaming do not exist. If revived: re-add contexts to `upload.types.ts`,
  `CONTEXT_CONFIG` and `handlers/index.ts`, and do **not** reintroduce HLS in the private bucket.
- Capacitor: `capacitor.config.ts` (`appId: vercel.chat.app`, `webDir: www`) does not match the Angular
  output (`dist/chat-app/browser`) and no native platform folders exist — the mobile shell is not
  wired up.
- `recaptchaSiteKey` is in both environment files but nothing uses it; no server verification either.
  Either implement it on register/login or delete it from the environments and docs.
- Support/legal links are blank on purpose (`supportEmail`, `termsUrl`, `privacyUrl`, `appVersion`).

### Code hygiene (verified)

- Client `AttachmentVariants.hls`, the `file-upload` WS type, and the `FileUploadMessage` interface are
  dead leftovers. `convertToMessageType` in `message.interface.ts` is exported but unused.
- `side-effects.ts` still exports an empty `onPostMediaComplete`; nothing references it.
- `upload.model.ts` comments mention posts/stories (`expiresAt: // for stories`, `resourceId: // postId`);
  `upload.types.ts` comment says `groupId, postId, etc.`.
- `.mcp.json` registers `spartan-ng` and `spartan-ui` against the same package.
- `index.ts` CSP `imgSrc` still lists `http://localhost:3000`; `/health-check` logs on every hit.
- Offset pagination (`skip`/`limit`) everywhere; fine now, expensive for very long histories.

### `README.md` is stale in these places

- Project tree lists `features/calls/` (does not exist).
- Feature list and env block mention reCAPTCHA (`RECAPTCHA_SECRET_KEY`) — no code reads it.
- "Mutes are permanent — `muted_until` is declared on the model" — the field was removed.
- Upload contexts list omits `cover-photo`; env block omits `LOG_LEVEL`.
- WebSocket table lists `authenticate` as a client→server type; it is ignored (auth happens at the
  upgrade) and `message` is server→client only.
- No mention of `dm_key`, or the removal of HLS.

---

## 16. Recipes

- **New upload context**: union in `server/src/upload/upload.types.ts` → `CONTEXT_CONFIG` entry →
  extension map in `upload.controller.ts` (if new MIME types) → handler + `contextHandlers` entry →
  an `onComplete` side effect → `bucketForContext` / `PRIVATE_CONTEXTS` if it isn't `dm-*` → mirror the
  union, `MAX_SIZE_MB` and `defaultAllowed` on the client → storage categories in `storage.controller.ts`.
- **New server→client WS event**: publish through `webSocketServiceInstance.sendToUsers`/`broadcast`
  (API) or `emitToUser`/`broadcastToParticipants` (worker/anywhere); add the type to
  `websocket.dto.ts` and the client `web-socket-message.interface.ts`; handle it in the chatbox (open
  thread) or a root service (needs to work on every route, like `NotificationService`).
- **New client→server WS frame**: add to the allowlist `switch` in `WebSocketController`, give it an
  entry in `WS_RATE_LIMITS`, stamp identity from the socket — never from the payload.
- **New authenticated route**: mount under the block in `index.ts` *below* the CSRF/limiter group, add
  `authenticateToken` (+ `requireVerifiedEmail` if it's messaging), validators **followed by**
  `validateRequest`, and add the label to `FIELD_LABELS`. Throw `createCustomError`, don't hand-roll a 500.
- **New rate limiter**: create in `rate-limiter.ts` with its own `keyPrefix`; volume-style limiters after
  validation, guessing-style first; call `resetRateLimit` only where success should forgive.
- **Changing the password policy**: edit `password-policy.ts` *and* `password.validator.ts` *and* the
  shared vector table both suites run.
- **Anything that pushes to users**: never a bare `sendToUser` outside the local-process subscriber.
- **Before enabling `REQUIRE_EMAIL_VERIFICATION`**: run `npm --prefix server run backfill:verified`.
