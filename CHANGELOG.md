# Changelog

## Unreleased

Server typechecks (`tsc --noEmit`) and the app builds in both dev and production
configurations. There are no automated tests in the repo, so unless an item says
otherwise it is verified by compilation and code review only. Test steps are
noted where the behaviour is not obvious.

**One exception:** everything under *Fixed — notifications, verified against a
live stack* was driven against live Mongo and live Redis, and includes a data
migration that has already been applied to the cluster in `.env`.

---

## Fixed — flows that did not work at all

- **Conversation video could not play in Chrome or Firefox.** DM video was
  transcoded to HLS only and rendered with `<video [src]="…index.m3u8">`, with
  no hls.js anywhere in the project — native HLS is Safari-only. It was also
  written to the private bucket, which HLS fundamentally cannot be served from:
  playlists and segments are relative URLs and would go out unsigned. DM video
  now produces a single progressive MP4 (720p cap, faststart, yuv420p) which
  plays everywhere and needs exactly one signature. HLS is retained for the
  public post/story contexts.
  *server/src/processors/handlers/video.handler.ts, video-player.html*

- **Avatar upload 404'd.** It PATCHed `FormData` to `/user/profile-picture`,
  a route that does not exist (and no multipart parser is mounted). Rewired
  through the presign → upload → confirm pipeline the worker already supports
  via `onAvatarComplete`, with the new URL applied when `upload-ready` arrives.
  *src/app/features/user/services/user.service.ts, profile-settings.ts*

- **Notifications were never created.** `createNotification` had zero callers,
  so no notification document was ever written and no badge could appear;
  `markNotificationsAsSeen` existed but was never routed. Now invoked on message
  creation (skipping INFO messages), with `PATCH /notifications/seen` added —
  optionally scoped to one conversation, and resetting `unread_count` so the
  badge number clears rather than just the `seen` flag.
  *server/src/messenger/services/message.service.ts, routers/notifications.router.ts*

- **The worker never configured ffmpeg.** `ffmpeg.setFfmpegPath()` ran in the
  API process, which does no transcoding, leaving the worker dependent on
  whatever was on `$PATH`. Moved to `worker.ts`, using the `ffmpeg-static`
  binary, with a startup probe that logs loudly if `ffprobe` is missing instead
  of failing every job later. `audio.handler` no longer shells out to `ffprobe`
  directly and no longer throws when a file reports no streams.
  *server/src/worker.ts, index.ts, processors/handlers/audio.handler.ts*

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

## Fixed — mobile and input handling

- **The send button was enabled or disabled at random.** `hasSendableContent`
  was a `computed()` reading `messageControl.value` — a FormControl, not a
  signal. Nothing invalidated the computed when you typed, so it kept whatever
  it had cached the last time `pendingAttachments` happened to change. In a new
  conversation the route change clears attachments immediately before you start
  typing, which cached `false` and left the button dead for that whole
  conversation. The draft is now a signal (`toSignal(valueChanges)`).
  *chatbox.component.ts*

- **`canMessage` doubled as a send-in-flight latch.** It was set to `false`
  before each send and only restored on success, so a send that never settled
  disabled the composer permanently. It now means only "a conversation is
  loaded"; double-sends are prevented by stamping `lastMessageSentAt` when the
  send starts rather than when it finishes (which also closed the window where
  two fast taps both passed the throttle).
  *chatbox.component.ts*

- **The chat could not be scrolled on mobile.** The message wrapper inside the
  scroll container had `h-full`, pinning it to exactly the container height in a
  `column-reverse` flex context — the overflow then sits past the block-start
  edge, which WebKit will not scroll to. Desktop Chrome tolerated it; mobile
  Safari did not. Changed to `min-h-full`, and the scroll area now declares
  `overscroll-contain touch-pan-y`.
  *chatbox.component.html*

- **The swipe-gesture directive fought the scroll container.** `@HostListener`
  registers `touchmove` as non-passive and inside the Angular zone, so every
  frame of every scroll blocked on a handler and triggered a full
  change-detection pass. It now binds passive listeners outside the zone and
  bails out as soon as a gesture commits to the vertical axis.
  *pan.directive.ts*

### Video player — rewritten

The controls overlay was revealed by `mouseenter`/`mousemove` only, so on a
phone it stayed at `opacity-0` with `pointer-events-none`: nothing could be
paused, scrubbed or fullscreened. Player state was also inferred rather than
observed. Rewritten around the element's own media events.

**Compatibility**
- `playsinline` + `webkit-playsinline` + `x5-playsinline`. Without the first,
  iOS hijacks playback into its own fullscreen player and the custom UI never
  appears at all.
- Fullscreen falls back to `video.webkitEnterFullscreen()` — iPhone implements
  the Fullscreen API on video elements only, never on a container div, so the
  button was inert there. iOS's `webkitbegin/endfullscreen` events are now
  observed too, since they don't fire `fullscreenchange`.
- Seeking moved from `mousedown`/`mousemove` to pointer events with pointer
  capture: one code path for mouse, touch and pen, and the drag survives the
  finger leaving a 4px track. `touch-action: none` stops the page scrolling
  mid-scrub.
- Volume is persisted (localStorage, guarded — it throws in private mode) and
  synced from `volumechange` rather than a `volume` *attribute* that does not
  exist. The slider is hidden on coarse pointers, where iOS ignores volume
  entirely and no hover exists to reveal it; mute still works everywhere.

**Correctness**
- `ended` comes from the `ended` event instead of `currentTime === duration`,
  which is float equality and routinely missed.
- `duration` guards against `Infinity`/`NaN` (streams, metadata not yet loaded);
  seeking is disabled and the readout shows `--:--` instead of `NaN:NaN`.
- `play()`'s promise rejection is handled — autoplay-policy blocks and
  `AbortError` from a `pause()` racing a `play()` used to surface as unhandled
  rejections.
- Buffering spinner from `waiting`/`playing`, a real buffered-range bar, and an
  error state with retry. `loaded` is emitted on error too, so a host that hides
  the player until it loads can't spin forever.

**Seeking**
- Every seek path — timeline drag, keyboard arrows, `Home`/`End` — goes through
  one `applySeek`. Timeline scrubbing previously assigned `currentTime`
  directly, which is precisely the write Chromium discards when there are no
  seekable ranges, so dragging stayed broken there even after the clamping below
  was added for the other paths.
- Seeks are clamped to the element's `seekable` ranges, falling back to
  `buffered`. Chromium only honours a seek to a position it considers seekable,
  and it populates `seekable` solely from responses that support HTTP Range
  (206 Partial Content); Firefox buffers the whole file and seeks within
  `buffered` regardless. A host that answers every request with a plain 200
  therefore yields video that plays but cannot be scrubbed **in Chromium only**
  (Chrome and Brave alike). The player logs that diagnosis the first time a seek
  finds no seekable range, instead of appearing to ignore the input.

  **Root cause — Cloudflare, not the app.** Measured against the live endpoint:

  | Request | Cache path | Result |
  |---|---|---|
  | SDK `GetObject` + `Range` (sends `Authorization:`, so CF bypasses cache) | origin | `206`, `Content-Range: bytes 0-99/2795361` |
  | Presigned URL + `Range` (no auth header, so CF caches) | Cloudflare | `200`, full body, no `Accept-Ranges`, no `Content-Length` |
  | Same presigned URL again | `cf-cache-status: HIT` | identical broken response |

  The SeaweedFS origin serves Range correctly. Cloudflare caches the object
  (`Cache-Control: max-age=14400`) and re-serves it chunked with `Accept-Ranges`
  stripped, and gzips the mp4 outright when the client advertises gzip — which
  makes byte ranges impossible by construction. The browser only ever uses the
  presigned path, hence the browser split.

  **Fix is in Cloudflare, scoped to the storage hostname:** a Compression Rule
  set to *off*, a Cache Rule set to *bypass*, then **purge the cache** — the
  broken representation is already stored and will keep being served for up to
  4 hours otherwise. Verify with
  `curl -s -o /dev/null -D - -r 0-99 -H 'Accept-Encoding: identity' "<signed url>"`
  and expect `206` plus `accept-ranges: bytes`.

**UI**
- The volume slider is vertical and floats above the mute button rather than
  sitting inline. Inline, revealing it widened the controls row and pushed the
  timestamp and fullscreen button sideways, and every breakpoint had to budget
  for a control that may or may not occupy space. Orientation uses
  `writing-mode: vertical-rl` + `direction: rtl` (the standardised form, and the
  one that puts minimum volume at the bottom) with `appearance: slider-vertical`
  behind it for older WebKit/Blink.
- The popup sits flush on top of the button with no vertical offset. Its reveal
  transition briefly ended at `translateY(-0.25rem)`, opening a 4px gap between
  button and pill — an unhovered dead zone that closed the popup the instant the
  cursor left the button, making the slider impossible to reach. The reveal now
  scales and fades only; it must never translate away from the button.
- Hiding uses `opacity` + `pointer-events` rather than `visibility: hidden`,
  which would pull the slider out of the tab order and stop `:focus-within` from
  ever firing — leaving keyboard users unable to open it at all.
- No on-screen skip buttons: keyboard arrows (±5s) and the timeline cover it,
  and two extra controls crowded the row on small inline players.
- The centre play button rendered `lucidePause` while labelled "Play" and shown
  only when paused.
- Control buttons had `size-8` and nothing else inside a flex row. `flex-shrink`
  defaults to `1`, so their width collapsed under pressure — a long duration
  label, a narrow player — while height stayed fixed, which is why the circles
  were often ovals. They now use fixed metrics with `flex: 0 0 auto` and grid
  centring, in component CSS rather than fighting `hlmBtn`'s own size variants
  (`size="icon"` sets `size-9`, which the template then overrode with `size-8`).
- 44px touch targets on coarse pointers, `focus-visible` rings, `aria-label` on
  every control, `role="slider"` with full `aria-value*` and arrow/Home/End
  support on the timeline, and `prefers-reduced-motion` honoured.
  *video-player.ts, video-player.html, video-player.css (new)*

## Fixed — behaviour

### Attachments that never arrive

- **A permanently failed upload told nobody.** The worker marked the `Upload` and
  the message attachment `failed` in Mongo and stopped there — no websocket
  event, and no `upload-failed` message type existed on the client at all. The
  placeholder therefore stayed in its loading state until a full reload, which
  reads as a hang. The worker now emits `upload-failed` to every participant, and
  the client marks the attachment accordingly.
- **Infected uploads only notified the uploader.** Everyone else in the
  conversation kept a spinner for a file that was never coming. Both terminal
  outcomes now fan out to all participants via `notifyAttachmentOutcome`; the
  uploader still gets the virus names, the others just learn it is not arriving.
- Terminal states are rendered. `failed` previously fell through to the same
  skeleton as `processing` for images, audio and files, and for video it produced
  an *empty bubble* — `getPrimaryAttachment` returns null and `isProcessing` is
  false, so no branch matched and the message looked like it had vanished.
- `lucideAlertCircle` was used by the infected-file branch but never passed to
  `provideIcons`, so that state rendered a missing icon. Now `lucideTriangleAlert`,
  registered.
- `WORKER_CONCURRENCY` had two different defaults — `2` read directly from
  `process.env` in `worker.ts`, `4` in `config.ts`. The config value was never
  read by anything. The worker now goes through config.

### Conversations and stability

- **A stray rejection could kill the whole API.** `createNotification` was called
  as `void createNotification(...)` with no `.catch()`, and there was no
  `unhandledRejection` handler. Node terminates the process on an unhandled
  rejection by default, so a Mongo or Redis blip during an ordinary message send
  would take down the API and every websocket connection on the instance. Both
  call sites now catch and log, and `index.ts` installs process-level handlers as
  a backstop.
- **Renaming a group blanked out its members.** `updateConversation` broadcast a
  bare `conversation.toObject()` — participants as raw ObjectIds — and the
  client's `updateConversationState` *replaces* the stored conversation with the
  payload. Every member's username and avatar vanished until reload, rendering
  senders as "Unknown". Now populated before broadcast, as
  `onGroupAvatarComplete` already did.
- **Deleting a conversation told nobody.** Other participants kept it in their
  list, and every message in it 404'd, until they reloaded. It now broadcasts
  `conversation-leave` *before* deleting — `broadcast()` resolves recipients by
  looking the conversation up, so afterwards it would deliver to nobody.
- **Two clients opening the same DM at once produced a 500.** Both passed the
  `findOne` pre-check, both inserted, and the unique `dm_key` index rejected the
  loser with E11000. Now reported as the same 409 the pre-check returns.
- `findConversationIdByUserId` validated its ids *after* passing them to
  `new Types.ObjectId()`, which throws on a malformed id — so the 400 guard was
  unreachable and bad input surfaced as a 500.

### Notifications — client half implemented

The server has always maintained notifications: `createNotification` writes an
unread count per participant on every message and publishes a `notification`
event. Nothing consumed it. `NotificationService` on the client was an empty
stub whose `totalUnread` signal was never written, and the websocket `case
'notification'` was commented out, so the badge could only ever read zero.
The service now loads initial counts at login, applies realtime events, and
clears a conversation's badge when you open it.

**Superseded:** `NotificationBell` was never mounted in any template. Rather
than placing it in a layout, per-conversation badges on the conversation cards
took over the job and the bell has since been deleted — see *Removed*. The
counts themselves were subsequently reworked from an `$inc` running total into a
derived value; see *Fixed — notifications, verified against a live stack*.

### Latent traps and leaks

- **Typing indicators could be pushed into conversations you are not in.**
  Identity is safe — `websocket.setup.ts` re-stamps every client-supplied id with
  the one proven at the upgrade handshake — but `handleTyping` never checked
  *membership*, so any authenticated user could name an arbitrary conversation id
  and have the server relay "X is typing" to its participants.
  `handleMessageStatus` already did this check; `handleTyping` now does too.
- **`validateConversation` was one keyword away from denying all access.** It
  used `participants.includes(new ObjectId(userId))`, which works only because a
  hydrated Mongoose array proxies `includes` into an `.equals()` comparison.
  Adding `.lean()` to that query — a routine optimisation, and one this codebase
  already applies to similar queries — drops the proxy, `SameValueZero` reference
  comparison applies, and every membership check silently returns false. Verified
  both ways against the live database; now compares as strings, like every other
  membership check in the codebase.
- **`WebSocketService.reset()` removed.** Nothing called it, and anything that
  had would have broken the app silently: it replaced `messages$` with a fresh
  Subject while `typingMessage`, `userStatusMessage` and `messageStatusMessage`
  hold `toSignal` subscriptions taken against the original instance, so typing
  indicators and read receipts would stop updating for the rest of the session
  with no error. It also bought nothing — a plain Subject holds no buffered
  state. `messages$` is now `readonly` so the trap cannot return.
- The settings layout subscribed to `router.events` — an app-lifetime stream —
  with no teardown, so every visit left another live subscription writing
  `activePageTitle` on a destroyed component.
- `lucideBell` was rendered by the notification bell but never registered, and
  there is no app-level `provideIcons`, so the bell icon did not appear at all.
- `timeAgo` was a pure pipe, so a timestamp — whose reference never changes —
  never re-rendered: "just now" stayed "just now" indefinitely on a quiet chat.
  It is now impure and reads a shared 30s clock signal; both halves are needed,
  since the signal read is what marks the view dirty and impurity is what allows
  `transform` to run again.
- The read-receipt effect branched on `prevId === undefined` for its first-load
  case, but `previousConversationId` is `string | null` and starts at `null` — so
  that branch was unreachable and its sibling `prevId !== undefined` was always
  true. The work happened anyway via the other condition; the dead comparison is
  gone.

### Other

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
- Spacebar in the media viewer controls the video *in the viewer*; it used to
  `document.querySelector('video')`, which returns the first video on the page —
  usually an attachment preview in the composer behind the overlay.
- Failed media downloads raise a toast instead of only a console error.
- `searchUsers` encodes its query; `&`, `#` or `+` in the search text silently
  corrupted the request.
- A corrupt `selectedUser` in sessionStorage no longer throws during bootstrap
  and brick the app.
- `timeAgo` handles future timestamps (clock skew made fresh messages render as
  a raw ISO string) and invalid dates.
- Pan gestures ignore multi-touch, so a pinch-zoom can no longer emit a large
  bogus `deltaX` and navigate away from the chat.
- Videos opened from a message card or the media panel use the right URL —
  both built image-only URLs, so the media panel literally opened `"undefined"`.

---

## Fixed — notifications, verified against a live stack

Unlike the rest of this file, everything in this section was exercised against
live Mongo (Atlas) and live Redis by a scripted harness that stands up its own
throwaway users and conversations, drives the real HTTP and websocket paths, and
deletes its fixtures afterwards. 12/12 scenarios pass.

The unread count is now *derived* from the messages collection rather than kept
as an `$inc` running total, and the number on the notification document is only
a cache. That change is what the items below either complete or clean up after.

- **Users added to a group inherited its entire history as unread.** The derived
  count is bounded by the user's watermark — the newer of their last read
  message and their `seen_at` — and a user added to an existing conversation had
  neither until `seedNotificationWatermarks` started issuing one at join time.
  Rows written before that only ever had the old `$inc` value, so the first load
  after deploy would have replaced a correct count with the conversation's whole
  history. Observed on real data: a user added nine minutes after a group was
  created stored 14, which was right, while the derivation returned 21 — the 14
  since they joined plus 7 they were never there for.

  `scripts/backfill-notification-watermarks.ts` (`npm run backfill:notifications`,
  dry run unless given `--apply`) repairs those rows by treating the stored value
  as the truth and fabricating the watermark that reproduces it: `seen_at`
  becomes the timestamp of the (stored + 1)-th newest message that would
  otherwise count. Rows whose derivation already agrees are untouched, which is
  every row written since the refactor. **Run once per environment**; it has been
  applied to the cluster in `.env` and `npm run diagnose:notifications` now
  reports no duplicates and zero drift.
  *server/src/scripts/backfill-notification-watermarks.ts*

- **Muting a conversation did not survive a reload.** `createNotification` skips
  muted recipients, so no realtime event was ever pushed — but
  `refreshNotificationsForUser` recomputed *every* row for the user with no mute
  filter, and `GET /notifications` returned them all. The badge came back on the
  next page load, which is the one place the count is read rather than pushed.
  Muted rows are now skipped by the refresh and withheld from the response.
  Muting also clears and pushes the badge immediately instead of leaving it on
  screen, and unmuting recomputes rather than waiting for the next message.

  The stored value on a muted row is deliberately left alone rather than zeroed,
  and `seen_at` is not stamped: muting is not reading, so the watermark has to
  stay where it is for unmuting to restore what accumulated.
  *server/src/messenger/services/notification.service.ts, conversation.service.ts*

- **Mute could never be set in the first place.** `muteConversation` and
  `unmuteConversation` existed on the service and the controller, and every read
  path honoured a mute, but nothing routed to them — there was no reachable
  endpoint. Added `POST`/`DELETE /conversations/:id/mute` behind the existing
  `validateConversation` membership check, plus `GET /conversations/muted` for
  the settings screen. The handlers now read `req.params.id` to match the rest of
  that router.
  *server/src/messenger/routers/conversation.router.ts, controllers/conversation.controller.ts*

- **A removed group member kept a badge that climbed forever.** Nothing deleted
  notification rows, and the derived count filters by conversation without
  checking participation, so every subsequent message in a group someone had been
  removed from still incremented their counter — and `GET /notifications`
  populated the group's name, picture and participant list back to them. Rows are
  now dropped when a member is removed and when a conversation is deleted (along
  with its mutes), and the refresh prunes any row whose conversation is gone or
  no longer lists the user.
  *server/src/messenger/services/conversation.service.ts, notification.service.ts*

- **Read receipts were not checked against the conversation they claimed.** The
  comment said the message had to belong to it; the query that would have proved
  it discarded its result, so the receipt was written either way. Since the
  receipt becomes the user's unread watermark and the watermark is that message's
  timestamp, naming a message from another conversation — or a newer one from
  anywhere — silently moved the count. The lookup is now awaited and the receipt
  rejected if it does not match. Identity was never the issue here:
  `websocket.setup.ts` already re-stamps every client-supplied id with the one
  proven at the upgrade handshake, and the handlers now take that id directly so
  the guarantee does not depend on remembering to stamp a new field.
  *server/src/websocket/controllers/websocket.controller.ts*

- **`diagnose-notifications` reported drift that did not exist.** It counted
  uncapped while the service caps at 99, so any conversation past 99 unread was
  permanently flagged against a value the service stores on purpose.
  *server/src/scripts/diagnose-notifications.ts*

Also fixed while in `manageConversationMembers`: watermark seeding and row
cleanup ran *before* `conversation.save()`, so a failed save left watermarks and
deletions describing a membership change that never happened. Both now follow the
save, and seeding still precedes the join's info message.

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
- The notification settings page now lists your conversations with working mute
  toggles, applied optimistically and rolled back if the request fails. Muting is
  the only notification preference the server actually implements, so it is what
  the screen shows instead of the inert switches it used to. Backed by a
  root-provided `NotificationSettingsService` rather than the existing
  `ConversationService`, which is provided on the `messages` route and so is not
  reachable from `/settings`.
  *src/app/features/user/components/settings/notifications/*
- `npm run backfill:notifications` — see the notifications section above.

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
- `GET /notifications` derives every conversation in a single aggregation
  instead of one `countDocuments` per row. Each conversation carries its own
  watermark, so the match is an `$or` over per-conversation clauses grouped by
  conversation; `sender` and `type` are constant because the user is, and each
  branch is served by the same `{ conversation, timestamp }` index. Measured with
  mongoose query logging: a user with six conversations went from six message
  queries per load to one. The single-conversation path keeps its capped
  `countDocuments`, which can still short-circuit at 99 — the aggregation counts
  in full and caps afterwards, since aggregation has no way to express a
  per-group limit.

---

## Removed

- `ViewportTopVisibleDirective` — referenced by no template, and it listened to
  `window` scroll, which never fires here (the chat scrolls in an inner
  container).
- `s3-transfer.service.ts` — no callers; had it been used, it would have written
  released quarantine files to the *public* bucket.
- `MediaViewerService.openMedia` / `openSingleMedia` / `openMediaGallery` /
  `hasEnoughForGallery` — the one real caller now builds its own item list and
  goes through `openGallery` like everything else, instead of the service
  reaching back into message state.
- `MediaViewerService` is no longer re-provided on the `:id` route; it is
  `providedIn: 'root'`, so that just created a second instance.
- `MessageService.uploadFileMessage()` — posted to `/messages/upload`, which does
  not exist.
- The email form on the unlock page (there is no "request an unlock link"
  endpoint; the link arrives in the lock email).
- `UpdateConversationI.group_picture` is now a URL string, not `File | Blob` —
  binaries go through `UploadService`.
- `NotificationBell` — never mounted in any template, and its `totalUnread` had
  no consumer. Per-conversation badges on the conversation cards replaced it.
- The browser-notification permission prompt in `app.component.ts`. It called
  `Notification.requestPermission()` while the project contains no
  `new Notification(...)`, no service worker and no web-push, so the prompt led
  nowhere. `AppComponent` no longer needs `OnInit` or `AuthService`. The dead
  commented-out `NotificationService` wiring in `app.component.ts` and
  `app.routes.ts` went with it — it referenced `loadNotifications()`, a method
  that no longer exists under that name.
- The hardcoded toggle list on the notification settings page — five switches
  with no GET, no PATCH and no preferences model behind them. Nothing they did
  was persisted or read.

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
  machine are where these bugs clustered. The notification work was verified by a
  throwaway harness driving a live stack, which is not checked in — the 12
  scenarios it covers are the obvious first specs.
- **`createNotification` still counts once per recipient.** It runs on every
  message, so a group of twenty costs twenty counts. Batching it is harder than
  the read path was: each recipient has a different `sender: { $ne }` filter as
  well as a different watermark, so one message can match several recipients'
  clauses and a `$group` by conversation cannot separate them — it wants a
  `$facet` keyed per recipient.
- **`createNotification` also publishes one Redis message per recipient.**
  Batching into a single publish means changing the `ws:notification` subscriber
  payload in `server/src/index.ts`.
- **`muted_until` is declared on the mute model and never enforced.** Mutes are
  permanent and the field is dead; the settings UI has no duration picker for the
  same reason.
- **`markMessageAsRead` in the chatbox is not guarded by `isCurrentConversation`.**
  It is correct today only because `findMessageById` searches the active
  conversation's messages and so never finds a foreign one. If `activeMessages`
  ever holds more than one conversation, messages in other chats start marking
  themselves read.
- **`handleChatMessage` in the websocket controller is unreachable** — there is
  no `'message'` case in the dispatcher.
