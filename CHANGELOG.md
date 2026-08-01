# Changelog

## Unreleased

49 files changed, 5 added. Server typechecks (`tsc --noEmit`) and the app builds
in both dev and production configurations. **Nothing here has been run against a
live stack** — there are no automated tests in the repo, so every item below is
verified by compilation and code review only. Test steps are noted where the
behaviour is not obvious.

---

## ⚠️ Required migration

Two changes need a manual step before they take effect.

### 1. Drop the broken conversation index (blocking)

`{ participants: 1 }` was declared `unique` with `partialFilterExpression: { is_group: false }`.
That is a **multikey** unique index: uniqueness applies to each array element
across documents, so once a user appeared in one DM, any second DM containing
them failed with E11000. It is replaced by a scalar `dm_key`.

```js
// mongosh <your db>
db.conversations.dropIndex('participants_1');
db.conversations.find({ is_group: false, dm_key: { $exists: false } }).forEach(c =>
  db.conversations.updateOne(
    { _id: c._id },
    { $set: { dm_key: c.participants.map(p => p.toString()).sort().join(':') } }
  )
);
db.conversations.getIndexes();   // participants_1 should be gone
```

Restart the API afterwards so Mongoose builds `dm_key_1`. If that build fails
with E11000 there are genuine duplicate DMs in the data — dedupe them first.

**Test:** open DMs with two different people from the same account. The second
one used to 500.

### 2. New indexes build on boot

`{ conversation, timestamp }` and `{ attachments.uploadId }` on `messages`, and a
TTL index on `uploads.expiresAt`. These build automatically on restart; on a large
`messages` collection expect the first boot to take a while.

---

## Security

- **Anyone could overwrite any group's picture.**
  `onGroupAvatarComplete` wrote to `payload.resourceId`, which came from the
  client at presign time and was never checked. `presign` now verifies the caller
  is a participant of the target conversation for `group-avatar` uploads.
  *server/src/upload/upload.controller.ts*

- **Read receipts were spoofable.** The websocket layer stamped the top-level
  `user_id` from the authenticated socket but not `read_receipt.user_id`, so a
  client could mark messages read on behalf of another user, in any conversation,
  and flip *any* message id in the database to READ. The socket's proven identity
  is now stamped onto every id the handlers act on, the sender must be a
  participant, and the message update is scoped to the conversation.
  *server/src/websocket/websocket.setup.ts, websocket/controllers/websocket.controller.ts*

- **Every user's email address was readable by any logged-in user.**
  `getUserById`, `getUsers` and `searchUsers` returned the whole document minus
  `password`, which still included `email`, `is_email_verified`, `login_attempts`,
  `lock_until` and `blocked_users` — `/user?limit=100` was a mailing-list export.
  Replaced with explicit `PUBLIC_USER_FIELDS` / `SELF_USER_FIELDS` projections;
  account fields are only returned when you ask for yourself.
  *server/src/user/controllers/user.controller.ts*

- **Regex injection / ReDoS in conversation search.** The raw query string went
  into `$regex` on three fields: `.*` matched everything, `(a+)+$` pinned the
  database. Input is now escaped and length-capped; an empty query returns `[]`.
  *server/src/messenger/services/conversation.service.ts*

- **Conversation creation trusted the client.** The participant list was used
  verbatim — a user could create a conversation between two other people, with
  ids that need not exist, unbounded in size. The creator is now forced into the
  list, ids are validated and deduped, users must exist, 2–100 members.
  Membership changes are rejected on DMs (silently turning a DM into a group was
  possible) and tolerate a missing `add`/`remove` array, which used to throw.
  *server/src/messenger/services/conversation.service.ts*

- **Voice messages skipped the participant check.** `PRIVATE_CONTEXTS` in the
  signed-URL endpoint listed `dm-image`/`dm-video`/`dm-file` but not `dm-audio`,
  so DM audio variants were returned to any authenticated caller. Added.
  *server/src/upload/upload.controller.ts*

- **Attachment metadata came from the request body.** `mimeType`, `fileSize` and
  `context` are now read off the stored Upload record — the client could
  previously label anything as anything. `originalName` is capped at 255 chars.
  *server/src/messenger/services/message.service.ts*

- **The CSRF cookie survived logout.** It is set with a `domain`, but
  `clearCookie` was called without one, and a cookie is only overwritten when
  name + domain + path match. All three auth cookies now clear with the
  attributes they were set with.
  *server/src/auth/auth.controller.ts*

- **express-validator was inert.** `validationResult` was never called anywhere,
  so the validators on `/auth/register` and `/auth/login` recorded errors nobody
  read; bad input fell through to Mongoose and surfaced as a 500. Added a
  `validateRequest` middleware returning 400 with field-level errors.
  *server/src/auth/middlewares/validate-request.middleware.ts* (new)

- **Account lockout now exists.** `login_attempts` and `lock_until` were on the
  model, an unlock endpoint and token type existed, and a security-alert email
  template sat unused — but nothing ever incremented or set the fields, so no
  account could ever lock. 10 failed attempts per account now lock it for 30
  minutes and send the alert email with unlock + password-reset links; login
  returns **423** with `retryAfter` while locked; a successful login clears the
  counter and any expired lock. Sessions are deliberately *not* revoked on lock —
  that would let anyone log you out of every device by failing to sign in.
  *server/src/auth/auth.controller.ts*

- **Presigned uploads no longer receive our cookies.** The interceptor tested for
  one hardcoded production S3 hostname; against any other bucket host it attached
  `withCredentials` and the CSRF header to the presigned PUT, breaking the
  signature or CORS. It now only stamps requests to `environment.apiUrl`.
  *src/app/features/auth/interceptors/http-options.interceptor.ts*

- Nginx now sends `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, and hides its version. *nginx.conf*

---

## Fixed — flows that did not work at all

- **Messages appeared twice when sent.** The message comes back twice — over the
  websocket (carrying `tempId`) and as the REST response (carrying `_id` only) —
  and reconciliation matched on `tempId` alone. Whichever arrived first left a
  second bubble behind. `fillInMessageDetails` now merges into the first entry
  matching *either* key and drops any further matches, so it is idempotent in
  both orderings and collapses a pair that already exists. `addMessage` also
  refuses to insert an id it already holds (websocket redelivery after a
  reconnect). Related: a message sent from a second device to a *different*
  conversation used to be prepended into whatever thread was on screen.
  *src/app/features/messages/services/message.service.ts*

- **Every mutating request failed for 15 minutes at a time.** On a 401 the
  interceptor refreshes and replays the original request — but `/auth/refresh`
  rotates the `csrfToken` cookie, and the replayed request still carried the
  header stamped before the refresh, so it 403'd and was not retried. This fired
  on the first POST/PATCH/DELETE after each access-token expiry. The retry now
  re-reads the cookie.
  *src/app/features/auth/interceptors/auth.interceptor.ts*

- **Group rename had no route.** `/conversations/:id` registered `.get()` and
  `.delete()` only, so `updateConversation` was unreachable; the client also sent
  `FormData` to an API with no multipart parser mounted. Added `.patch()`, switched
  the client to JSON, and rewrote the service method to validate that it is a
  group, trim and cap the name at 100 chars, and stop posting an "updated" info
  message when nothing changed.
  *server/src/messenger/routers/conversation.router.ts, services/conversation.service.ts,
  src/app/features/messages/services/conversation.service.ts*

- **Group pictures were never applied.** The client POSTed a raw `File` to that
  same ignored endpoint. It now goes through the real pipeline
  (presign `group-avatar` → upload → confirm → worker), and the worker broadcasts
  a `conversation-update` so members see the new picture without reloading.
  *src/app/features/messages/services/chatbox-settings.service.ts,
  server/src/processors/handlers/side-effects.ts*

- **Email verification could never succeed.** The link pointed at `/verify-email`
  while the route is `/auth/verify-email`, so it fell through to the catch-all
  user page and bounced off the auth guard — and the component never read the
  query params or called the API anyway. Both fixed.
  *server/src/auth/services/auth.service.ts,
  src/app/features/auth/components/verify-email/**

- **The unlock page hung forever.** Its submit handler was entirely commented out
  after setting `isLoading(true)`, and its email form did not match the
  token-based endpoint. Rewritten to consume `?token&id` from the email link.
  *src/app/features/auth/components/unlock-account/**

- **A single failed send disabled the composer permanently.** `canMessage` was
  set false before the request and only restored on success. It is now restored
  on failure too, the optimistic bubble is marked `failed`, and a toast fires.
  *src/app/features/messages/components/chatbox/chatbox.component.ts*

- **One error killed navigation and search for the rest of the session.** Both
  `handleError` helpers re-threw onto long-lived streams (route params, the
  websocket feed, the search stream), terminating the subscription. After a
  single 404 no further conversation would load; after one failed search, search
  stopped working. Both now return `EMPTY`.
  *chatbox.component.ts, conversation-list.component.ts*

- **Uploads failed intermittently with "Upload already confirmed".** Both the
  final `UploadProgress` event and the `Response` event report 100%, so `confirm()`
  fired twice — `switchMap` cancelled the first, and the second got a 400. Added
  `take(1)`.
  *src/app/features/upload/services/upload.service.ts*

- **Failed uploads spun forever.** The worker's failure handler passed the BullMQ
  *job id* to `Upload.findByIdAndUpdate` instead of `job.data.uploadId`, so
  nothing was ever marked failed. It now uses the right id, only marks failure
  once retries are exhausted, and reflects the outcome on the message attachment.
  Infected files now set `status: 'infected'` on both records instead of leaving
  a permanent spinner.
  *server/src/worker.ts, processors/upload.processor.ts, utils/attachment-status.ts* (new)

- **Real-time delivery went to the wrong people for up to an hour.** The
  broadcast participant list was cached in Redis for 3600s and — despite the
  comment saying otherwise — nothing ever invalidated it. Removed members kept
  receiving messages; added members received none. Now invalidated on membership
  change and on conversation delete.
  *server/src/utils/conversation-cache.ts* (new), *messenger/services/conversation.service.ts*

- **Cross-instance broadcasts were dropped under Docker.** Dedupe compared
  `process.pid`, and presence keys were namespaced by it — but containerised node
  is pid 1 everywhere, so instance B discarded instance A's messages as its own,
  and a restarting instance wiped another's presence set. Replaced with a
  per-process `INSTANCE_ID`.
  *server/src/websocket/services/websocket.service.ts, server/src/index.ts*

- **`worker:prod` pointed at `dist/worker.js`**; tsc emits `dist/src/worker.js`.
  *server/package.json*

---

## Fixed — behaviour

- Presence survives crashes: per-instance keys carry a 90s TTL refreshed by a
  heartbeat, and the global `online_users` set is rebuilt from live instances on
  boot. Previously a crash left users marked online forever.
- Websocket reconnection is now unbounded with capped exponential backoff and
  jitter (1s → 15s) instead of 5 linear tries totalling ~30s, plus `online` and
  `visibilitychange` listeners that retry immediately. On reconnect the client
  re-announces presence (previously sent only at login, so you looked offline to
  everyone afterwards) and reloads the newest message page, so messages sent
  during the outage appear without a refresh.
- Clearing the search box restores the full conversation list — the cache held
  the search results and was reused as if it were the full list.
- The conversation list handled every websocket event twice (subscribed in
  `ngOnInit` *and* re-subscribed inside the search stream), and the first
  subscription outlived the component.
- New conversations appear in the list immediately: the signal was mutated in
  place and returned by reference, so no consumer was notified.
- Pagination requested one empty extra page at the end of history (`<=` → `<`),
  and optimistic messages no longer vanish when a page loads (the merge dropped
  anything without an `_id`; it now falls back to `tempId`).
- Your own messages in a group show your name and avatar instead of "Unknown" —
  the API strips you from `participants`, which is the only place the lookup
  checked.
- Attachment size limits are per-context (mirroring the server: 500MB video,
  100MB file, …) instead of a flat 50MB that rejected videos the API accepts, and
  rejected files now raise a toast instead of vanishing silently.
- Voice recording works on Safari/iOS: the container is chosen with
  `MediaRecorder.isTypeSupported` rather than hardcoding `audio/webm`, which threw
  `NotSupportedError` and was reported to the user as "microphone denied". The
  mic is released on every exit path, blob URLs are revoked, and the filename and
  mime type are derived from the blob (with the `;codecs=` parameter stripped,
  which the server's exact-match whitelist would reject).
- Invalid conversation ids return 400 instead of 500.
- Password reset: the spinner never showed, the component re-submitted on any
  query-param change and leaked its subscription, and the success toast said
  "check your email inbox".
- Login no longer connects the websocket twice.

---

## Added

- `dm_key` on conversations — a sorted, joined participant pair used for DM
  uniqueness (see migration).
- `validateRequest` middleware, `invalidateParticipantsCache`,
  `markAttachmentStatus` helpers.
- `WebSocketService.onReconnect()`.
- `MessageService.markMessageFailed()`.
- TTL reaping of abandoned uploads: `presign` stamps pending records 24h out and
  the processor clears it once ready, so records referenced by messages are never
  reaped. **Note:** this only reaps database records — orphaned objects in the
  temp bucket still need an S3/SeaweedFS lifecycle rule.

### From `attachment-placeholders.patch`

Applied, with fixes (see below). Adds `FileVisualPipe` (per-extension icon,
colour and label), `pseudoWaveform`, video poster frames in the pending-attachment
strip, waveform UI for the audio player and recorder (live mic level while
recording, real extracted peaks on the preview), a single-image layout and video
duration badge in message cards, and a redesigned file tile.

The patch did **not** apply cleanly — it predates the `audio-recorder.ts` rewrite,
so it was applied with `--exclude='*audio-recorder.ts'` and that file hand-merged.
Its `audio-recorder.html` *was* in the applied set and references members only the
new component has, so applying with `--reject` would have left the app
uncompilable. Four defects fixed on top:

1. The new video tile carried `pointer-events-none` *and* a `(click)` handler, so
   it could never be clicked.
2. `playedBars` derives from `progressPercentage`, which was set to 100% on
   `paused` as well as `ended` — pausing lit up the entire waveform.
3. `seek()` multiplied by `attachment.duration`, which is 0 for uploads processed
   before duration extraction existed, so seeking always jumped to 0:00.
4. The live level meter wrote a signal on every `requestAnimationFrame`; rAF is
   zone-patched, so that was app-wide change detection at 60fps for the length of
   the recording. Throttled to ~20fps.

Also: `AudioContext` is resumed if suspended (a suspended context reads as
silence, so the meter never moved), recorder state resets between takes, and
videos in multi-attachment messages fall back to `variants.thumbnail` — they have
no `medium` variant, so they rendered as broken images (pre-existing).

---

## Performance

- `{ conversation: 1, timestamp: -1 }` on messages. Every message fetch was a
  collection scan with an in-memory sort.
- `{ 'attachments.uploadId': 1 }` — the upload worker looks messages up by it.
- `/user` list and search are capped (100 / 50) and `totalCount` counts the right
  collection field; it counted a non-existent `participants` field, so it was
  always 0 and the client could not paginate.
- Removed four render-blocking Google Fonts / Material Icons `<link>` tags from
  `index.html` — duplicated, and neither font is used (Inter is self-hosted,
  icons come from lucide).
- gzip enabled in nginx; `index.html` is served `no-cache` so clients stop booting
  a stale shell that references hashed chunks which no longer exist.
- One IntersectionObserver per chat instead of a new one on every re-entry.

---

## Removed

- `MessageService.uploadFileMessage()` — posted to `/messages/upload`, which does
  not exist.
- The email form on the unlock page (there is no "request an unlock link"
  endpoint; the link arrives in the lock email).
- `UpdateConversationI.group_picture` is now a URL string, not `File | Blob` —
  binaries go through `UploadService`.

---

## Known gaps

Deliberately not addressed:

- **Cursor-based pagination.** Offset/skip still shifts under a live stream.
  Changes the API contract; wants its own pass.
- **Websocket session lifetime.** A socket authenticated at upgrade outlives its
  15-minute access token, and logout does not close it.
- **Group permissions.** Any participant can still remove members or delete a
  conversation for everyone. Product decision, not a bug.
- **Audio waveforms are decorative for received messages.** The recorder extracts
  real peaks, but they are only used for the local preview — they are never
  uploaded, so recipients render a seeded fake. Closing this means extracting
  peaks in the worker and adding a `waveform` field to the attachment schema.
- **Orphaned temp-bucket objects** on upload failure (needs a bucket lifecycle
  rule).
- The `{ _id, 'read_receipts.user_id' }` unique index is a no-op that costs
  writes, but `handleMessageStatus` has an E11000 fallback keyed to it, so both
  were left alone.
- Placeholder template fields that do not exist on the user model: `roles`,
  `stats`, `website`, `location`, `joinedDate`.
- **There are still no tests.** Karma and Jasmine are configured; there is not a
  single `.spec.ts`. The auth flow, the read-receipt path and the upload state
  machine are where these bugs clustered.
