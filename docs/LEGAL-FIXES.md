# Legal fixes — what still needs doing

Working checklist for the gaps behind the `/legal` pages (Privacy Policy, Terms of Use, Cookies &
Storage), drafted 24 Nov. Same workflow as `SECURITY-FIXES.md`: one step at a time, reviewed
before the next.

The pages describe what the code does **today**, caveats included. So every code step below ends
with the sentence to change once the fix ships, and a bump of `LEGAL.lastUpdated` in
[`legal.config.ts`](../src/app/features/legal/legal.config.ts). Leave the caveat in until the fix is
deployed, not merely written.

The pages are drafts, not legal advice. Have a lawyer read them once Step 0b is done.

| Step | Topic | Status |
|---|---|---|
| 0 | Cloudflare Web Analytics: turn off or disclose | ✅ disclosed 28 Nov — deploy, lawyer question left |
| 0b | Fill in the operator facts (no code) | ✅ done 28 Nov — two notes below |
| **1** | **Delete stored files with the message** | **← current** |
| 2 | Presence: hidden last-seen and blocked users | |
| 3 | Quarantine retention | |
| 4 | Complete the data export | |
| 5 | Record which terms each account accepted | |
| 6 | Reports and moderation | |
| 7 | Processes (no code) — any time, in parallel | |

Steps 1 and 2 also close parts of `SECURITY-FIXES.md` Step 9 (M7/L3 "purge media when a message is
deleted", M15 presence). Tick them there too.

---

## Step 0 — Cloudflare Web Analytics (no code, your decision)

**What is true now:** production pages carry Cloudflare's beacon. A request with a browser user
agent to `https://chat-app.zura156.xyz/legal/privacy` (28 Nov) came back with
`<script src="https://static.cloudflareinsights.com/beacon.min.js/…" data-cf-beacon=…>`, and the
CSP in [`security-headers.conf:24`](../security-headers.conf) allows it
(`script-src … https://static.cloudflareinsights.com`, `connect-src … https://cloudflareinsights.com`).
A plain `curl` without a browser user agent gets no beacon, which is why the first check missed it.

The pages currently say *"We do not … use analytics or advertising trackers"* (privacy summary) and
*"We use no analytics, advertising or tracking cookies, and nothing from other websites"* (cookies
page). Both are false while the beacon is on. The pages are not deployed yet, so fix this before
they are.

**The problem is the mismatch, not the analytics.** Cloudflare Web Analytics sets no cookies and
Cloudflare already sees every request as the proxy, so the extra data is small: page loads,
referrer, browser, load timings — and, with SPA tracking on (`"spa"` in `data-cf-beacon`), in-app
route changes such as `/u/<userId>` that never reach the server. Either option below closes the
gap. Turning it off does **not** help I6: Cloudflare can change the HTML as the proxy either way.

**Option A — turn it off,** if you don't use the numbers. The pages are then already true, and the
CSP loses two third-party entries.

- [ ] Cloudflare dashboard → Web Analytics → this site → turn off automatic setup (or remove the
      site). The exact label moves around; what matters is the verification below.
- [ ] Remove `https://static.cloudflareinsights.com` from `script-src` and
      `https://cloudflareinsights.com` from `connect-src` in `security-headers.conf:24`.
- [ ] Verify: the browser-user-agent `curl` above shows no `cloudflareinsights`, and the app loads
      with no CSP errors in the console.
- [ ] Update the I6 line in `SECURITY-FIXES.md` (Steps 11–12).

**Option B — keep it and disclose,** if you do use them. **← chosen 28 Nov.**

- [x] Privacy Policy §2 "Information created as you use the Service": a "Usage statistics" bullet
      — page address (which can hold a conversation or profile id), referrer, browser and device
      type, load time, in-app screen changes; no cookies.
- [x] §3 table: a row for counting visits and measuring load times, legitimate interest.
- [x] §4 service providers: Cloudflare named, including the statistics.
- [x] Summary bullet and the cookies page lede no longer say "no analytics"; the cookies page has
      an "Other scripts" section.
- [x] `lastUpdated` bumped to 2026-11-28; `legal-pages.spec.ts` now fails if either page drops the
      disclosure or says "no analytics" again.
- [ ] Deploy the pages.
- [ ] Ask your lawyer whether EU users need to consent: the beacon sets no cookies, but it still
      reads from the device, and that question is not settled.

---

## Step 0b — Fill in the operator facts (no code)

All in [`legal.config.ts`](../src/app/features/legal/legal.config.ts). The draft banner goes away
when the five required ones are set, and `legal-pages.spec.ts` then expects no `[… not set]`
markers.

- [ ] `operatorName` — your legal name, or the company's registered name.
- [ ] `operatorAddress` — a postal address for legal notices. If you are an individual, a PO box or
      registered-agent address keeps your home address off a public page.
- [ ] `contactEmail` — defaults to `supportEmail` in **both** environment files, which are empty.
      Set up an inbox that a person reads: privacy requests, abuse reports and copyright notices
      all go there until Step 6 adds an in-app report button.
- [ ] `governingLaw` — the country (or state) whose law governs the Terms.
- [ ] `dataLocation` — look these up: the MongoDB Atlas cluster's region (Atlas → cluster
      overview), the country your server is in, and where your SMTP provider is.
- [ ] `minimumAge` — 16 by default. Confirm it, or lower it knowing which countries you serve.
- [ ] Bump `lastUpdated`.

**Checked 28 Nov:** all five are set (committed in `42225d0`), `supportEmail` is set in both
environment files, and `legal-pages.spec.ts` passes with no markers left. Two values to revisit:

- [ ] `operatorAddress` is `'Tbilisi, Georgia'` — a city, not a postal address. Notices and data
      requests need somewhere they can actually be delivered (a street address, PO box or
      registered-agent address).
- [ ] `dataLocation` is `'Georgia'`, but `SYSTEM_CONTEXT.md` lists MongoDB on **Atlas**. Unless the
      cluster runs in Georgia (Atlas → cluster overview shows the region), name both places, e.g.
      "Georgia and <Atlas region>".

---

## Step 1 — Delete stored files with the message

**Why:** [`deleteMessage`](../server/src/messenger/services/message.service.ts) (line 274) empties
the message (`message.attachments = []`, line 301) but never removes the stored files. They stay in
the private bucket until the sender deletes their account. The Help FAQ used to promise
"immediately and permanently"; the Privacy Policy now says the copies are kept.

### 1.1 Purge on delete

- [ ] Before clearing `message.attachments`, keep its `uploadId`s.
- [ ] After `message.save()`, purge them through `purgeUploads`
      ([`upload-cleanup.service.ts:77`](../server/src/upload/upload-cleanup.service.ts)), filtered by
      `userId: senderId` as well as the ids, so a forged id can never reach someone else's upload.
- [ ] Only purge ids **no other message still references**. Nothing stops one upload being
      attached twice: `createMessageWithAttachments` (line 325) checks the uploads exist and belong
      to the sender (line 363) but not that they are unused. After the save, ask
      `Message.distinct('attachments.uploadId', …)` which of the ids are still attached anywhere
      (the index at `message.model.ts:92` covers it) and skip those.
- [ ] Do not let a purge failure fail the delete — the user's request succeeded. `purgeUploads`
      already swallows storage errors; catch a database error around the call and log the ids,
      so they can be retried by hand.
- [ ] *(optional)* At send time, refuse an upload id that is already attached to a message. The
      "still referenced" check then becomes a backstop rather than the only guard.

### 1.2 Account deletion leaves the other person's files

- [ ] In [`account-deletion.service.ts`](../server/src/user/services/account-deletion.service.ts),
      line 43 purges only the departing user's uploads. Line 70 then drops every message in the
      "doomed" conversations (DMs and groups left with fewer than two members), including the
      **other** person's messages — but their files stay in storage with nothing pointing at them.
      Before line 70, call `purgeConversationUploads` for each doomed id, as conversation deletion
      already does (`conversation.service.ts:408`).

### 1.3 Worker race

- [ ] An attachment deleted while it is still processing: the worker writes its variants, then
      `Upload.findByIdAndUpdate(…, { status: 'ready', … })` at
      [`upload.processor.ts:86`](../server/src/processors/upload.processor.ts) updates nothing,
      because the record is gone. The variants are left with no reference. Use that call's return
      value: on `null`, delete the variants it just wrote. Export the key logic from
      `upload-cleanup.service.ts` (`keysForUpload` plus the batch delete) rather than copying it.

### Verify

- [ ] `server/src/tests/messenger/services/message.service.int.spec.ts` — mock
      `upload-cleanup.service` the way `account-deletion.service.int.spec.ts` does, and assert:
  - deleting a message with two attachments purges exactly those two ids, filtered by the sender;
  - an upload attached to a second message is **not** purged;
  - a text-only message calls nothing;
  - a purge that throws still returns the tombstone.
- [ ] `account-deletion.service.int.spec.ts` — a doomed DM with the *other* user's attachment
      calls `purgeConversationUploads` with that conversation's id.
- [ ] By hand: send a photo, copy its signed URL, delete the message, open the URL → `NoSuchKey`.

### Then change

- [ ] Privacy Policy §6, "A deleted message" bullet: replace *"The stored copies of files that were
      attached to it are currently kept until your account is deleted."* with a sentence saying the
      files are deleted from storage.
- [ ] Help FAQ in
      [`help-support-settings.ts`](../src/app/features/user/components/settings/help-support/help-support-settings.ts):
      the answer can say "permanently" again, and the comment above it goes.
- [ ] Bump `LEGAL.lastUpdated`; tick the purge item in `SECURITY-FIXES.md` Step 9.

---

## Step 2 — Presence: hidden last-seen and blocked users

**Why:** `finalizeUserStatusUpdate`
([`websocket.controller.ts:389`](../server/src/websocket/controllers/websocket.controller.ts))
checks only `broadcastsPresence` (line 404), which reads `online_status`. It then sends
`last_seen` to everyone the user shares a conversation with (line 421). So "last seen: nobody"
leaks every time you go online or offline. It also reaches users you have blocked who share a group
with you (M15).

### Server

- [ ] In [`privacy.service.ts`](../server/src/user/services/privacy.service.ts), next to
      `broadcastsPresence` (line 118), add a helper that says whether `last_seen` may be shared. The
      recipients here are always people who share a conversation, so `everyone` and `contacts`
      both allow it and `nobody` does not.
- [ ] Leave `last_seen` out of the payload when it is hidden. The DTO already has it optional
      (`websocket.dto.ts:96`).
- [ ] Drop blocked users from `notifyIds` with `blockedAmong`
      ([`blocking.service.ts:67`](../server/src/user/services/blocking.service.ts)) — it answers for
      a known set in one query each way.

### Client

- [ ] [`chatbox.component.ts:423`](../src/app/features/messages/components/chatbox/chatbox.component.ts)
      replaces a missing `last_seen` with `new Date().toISOString()`, which reveals the moment
      anyway. Pass it through as it is.
- [ ] Make `updateParticipantStatus`
      ([`conversation.service.ts:452`](../src/app/features/messages/services/conversation.service.ts))
      take `last_seen?: string` and only overwrite it when present. A hidden value then shows
      nothing, as the REST profile already does (`redactForViewer` deletes it).

### Verify

- [ ] `server/src/tests/user/services/privacy.service.spec.ts` — the new helper for all three
      values, and for missing settings (defaults).
- [ ] A spec on `finalizeUserStatusUpdate` with `sendToUsers` spied: `last_seen: 'nobody'` +
      `online_status: 'everyone'` → status sent, no `last_seen`; a blocked co-member → not in the
      recipients either way round.
- [ ] Client spec: `updateParticipantStatus(id, 'offline', undefined)` keeps the previous value.
- [ ] By hand, two browsers: A sets last seen to nobody; B, in a conversation with A, never sees a
      time when A signs out.

### Then change

- [ ] Privacy Policy §4, "Your profile" bullet: delete the sentence starting *"One exception
      today"*.
- [ ] Bump `LEGAL.lastUpdated`; tick the presence half of M15 in `SECURITY-FIXES.md` Step 9.

---

## Step 3 — Quarantine retention

**Why:** a file that fails the scan is copied to the quarantine bucket, and nothing ever deletes
that copy except the canary sweep, which covers only the canary account. Worse, account deletion
(`purgeUploads({ userId })`) removes infected records **without** their quarantine copies — and the
record is the only way to find a copy again (`quarantineKeyFor` needs its `fileKey` and id).

- [ ] Config: `QUARANTINE_RETENTION_DAYS` in [`config.ts`](../server/src/config/config.ts) — a
      default (30 is enough to investigate), anything below 1 refused. Add it to the README's env
      list.
- [ ] Move `deleteQuarantined`
      ([`canary-sweep.service.ts:47`](../server/src/upload/canary-sweep.service.ts)) into
      [`utils/quarantine.ts`](../server/src/utils/quarantine.ts) beside `quarantineKeyFor`, export
      it, and have the canary sweep import it.
- [ ] A new sweep: infected uploads whose `updatedAt` is older than the retention (`Upload` has
      timestamps, `upload.model.ts:28`; `updatedAt` is when it was marked infected). Delete the
      copies first, then **only** the records whose copies are confirmed gone — the canary sweep's
      rule, for the same reason.
- [ ] Schedule it in [`worker.ts`](../server/src/worker.ts) the way `startCanarySweep` is
      (line 124): once at start, then on an interval (daily is plenty), cleared on shutdown next to
      the canary timer (lines 96–101). Not a BullMQ job — the comment above `startCanarySweep`
      says why.
- [ ] Account deletion: before `purgeUploads({ userId })` (`account-deletion.service.ts:43`),
      delete that user's infected uploads' quarantine copies with the same helper.
- [ ] *(optional)* Copies orphaned by accounts already deleted can only be found by listing the
      bucket. Check whether the quarantine key may `List`; if not, a one-off with an admin key:
      list, delete anything older than the retention.

### Verify

- [ ] `server/src/tests/upload/quarantine-sweep.service.int.spec.ts`, built like
      `canary-sweep.service.int.spec.ts`: an old infected upload → copy deleted and record gone; a
      recent one → kept; a refused delete → record kept; `ready` uploads → untouched.
- [ ] `account-deletion.service.int.spec.ts`: an infected upload → its quarantine copy is deleted
      before the records go.

### Then change

- [ ] Privacy Policy §6, "Files that fail the malware scan" bullet: add "and are deleted after
      N days".
- [ ] Bump `LEGAL.lastUpdated`.

---

## Step 4 — Complete the data export

**Why:** people have a right to a copy of all the personal data you hold about them, and
[`exportUserData`](../server/src/user/controllers/storage.controller.ts) (line 86) covers only
the profile, conversation list, own messages and upload metadata.

- [ ] `blocked_users` — line 101 excludes it (`-password -blocked_users`). Include it as id +
      username only, not the other person's profile.
- [ ] `sessions` — `listSessions`
      ([`token.service.ts:83`](../server/src/auth/services/token.service.ts)): IP, user agent,
      created, last used, as it returns them.
- [ ] `two_factor` — which methods are on and when each was confirmed. **Never** `secret` or
      `recovery_codes` (`two-factor.model.ts:48`, `:54`): exporting them would hand anyone holding
      the file the second factor, and access rights do not require it.
- [ ] `notifications` and `muted_conversations` for the user.
- [ ] Files: add a download URL to each `ready` upload, signed with `signVariants` /
      `signPrivateUrl` ([`media-url.service.ts`](../server/src/upload/media-url.service.ts)). They
      expire with the signing TTL (6 h), so add an `urls_expire_at` field saying so.
- [ ] *(your call)* Messages other people sent you. They are about you too, but they are also the
      other person's data. Many messengers leave them out of an access export and offer a
      separate chat export instead; whichever you choose, the policy's "download a copy of your
      data" stays true.

### Verify

- [ ] A spec on the export: contains the new sections for a user who has each; the serialised
      JSON never contains `password`, `secret` or `recovery_codes`.

### Then change

- [ ] Nothing in the pages — they already promise a copy. If the Data & Storage screen describes
      what is in the export, update that.

---

## Step 5 — Record which terms each account accepted

**Why:** the notice under the forms is shown, but nothing records that it was. You cannot show who
agreed to which version, or ask people to agree again after a material change.

### One version, two places

- [ ] Client: add `termsVersion` to `LEGAL`, separate from `lastUpdated`. `lastUpdated` moves on
      every edit; `termsVersion` only when a change is material enough to ask everyone again.
- [ ] Server: a constant, e.g. `CURRENT_TERMS_VERSION` in a new `server/src/auth/legal.ts` — code,
      not env, because it changes with the text. Comment each copy pointing at the other, like the
      password-policy pair, and add a line to the root `CLAUDE.md` invariants.

### Record it

- [ ] [`user.model.ts`](../server/src/user/models/user.model.ts): a `terms_accepted` sub-document
      — `version`, `at`, `via` (`register` | `oidc` | `prompt`). Add it to `SELF_USER_FIELDS`
      (`user.controller.ts:46`) so the client can compare.
- [ ] Register: the client sends `terms_version` (from `LEGAL.termsVersion`) with the form. On the
      `/register` route (`auth.router.ts:159`) validate that it equals the current version, with a
      `FIELD_LABELS` entry and a message like "The terms changed while this page was open — reload
      and try again". Set `terms_accepted` in `new User({…})` (`auth.controller.ts:346`).
- [ ] Google/GitHub sign-up: `User.create` at
      [`oidc.service.ts:400`](../server/src/auth/services/oidc.service.ts) — set the current
      version, `via: 'oidc'`. The notice sits above those buttons on both the login and register
      pages. *(If you want proof of the exact version the person saw, pass it through
      `/auth/oidc/:provider/start` into the transaction — after Step 2b of `SECURITY-FIXES.md` has
      made the transaction tamper-proof.)*

### Existing accounts and later changes

- [ ] `POST /user/terms` on the user router (signed in, not email-gated, like the rest of `/user`):
      body `{ version }` must equal the current one; sets `terms_accepted` with `via: 'prompt'`.
- [ ] Client: once the profile has loaded, if `terms_accepted?.version !== LEGAL.termsVersion`,
      show a dialog linking the documents with "Agree and continue", plus sign-out and "delete my
      account" as the other ways out. Whether it blocks the app or can be dismissed is your call;
      blocking is the clearer record.

### Verify

- [ ] Register int spec: no or old `terms_version` → 400 with a field error; the current one →
      stored with `via: 'register'`.
- [ ] OIDC: a first sign-in stores `via: 'oidc'`; signing in to an existing account changes
      nothing.
- [ ] `POST /user/terms` with the wrong version → 400; the right one → stored.

### Then change

- [ ] Privacy Policy §2, "Security records": add "which version of the Terms you accepted, and
      when".
- [ ] Bump `LEGAL.lastUpdated`.

---

## Step 6 — Reports and moderation

**Why:** the Terms promise to act on reports, explain decisions and keep evidence, and if you ship
the iOS app, Apple requires a report button in apps with user content. Today reports can only
arrive by email, and
there is no way to remove someone else's content or suspend an account. This step builds the
minimum, with scripts instead of an admin UI.

### 6.1 Report model

- [ ] New model (e.g. `server/src/moderation/models/report.model.ts`): reporter; target
      `{ type: 'message' | 'user', id }`; conversation; reason — spam, harassment, hate,
      child sexual abuse, non-consensual intimate image, violence, illegal, copyright,
      impersonation, other; an optional note (capped, e.g. 1000 characters); status `open` |
      `actioned` | `dismissed`; resolution `{ action, note, at }`; timestamps.
- [ ] A **snapshot** taken at report time: sender, text, attachment upload ids, sent time. The
      sender can delete the message a second later; the snapshot is the evidence.
- [ ] A partial unique index on (reporter, target id) while `open`, so one person cannot flood one
      message.

### 6.2 `POST /reports`

- [ ] Mount it in [`index.ts`](../server/src/index.ts) **below** the
      `identifyForRateLimit` → `csrfProtection` block (lines 116–119), with `authenticateToken` and
      `requireVerifiedEmail`, like `/messages` (line 138).
- [ ] Its own limiter in [`rate-limiter.ts`](../server/src/auth/middlewares/rate-limiter.ts),
      declared like `registerLimiter` (line 375) — a volume limit (e.g. 20 an hour per user),
      placed after the validators (see `server/CLAUDE.md`).
- [ ] Message reports: the reporter must be a member of that conversation, and the message must
      still have content. No reporting yourself.
- [ ] After saving, email the operator through `utils/mailer.ts` at a new `REPORTS_EMAIL` env var
      (read in `config.ts`; the server cannot see the client's `contactEmail`, so set it to the
      same inbox): report id, type and reason — **not** the reported content. Mark child-abuse
      reports urgent in the subject.

### 6.3 Keep the evidence (amends Step 1)

- [ ] Step 1's purge and account deletion's `purgeUploads({ userId })` must skip upload ids held
      in an **open** report's snapshot. Purge them when the report is closed.
- [ ] For child sexual abuse material, the law where you operate may require preserving it for a
      set period after reporting — check before setting this.

### 6.4 Suspension

- [ ] `User`: `suspended_at`, `suspension_reason`.
- [ ] Refuse sign-in with 403 and a new code `ACCOUNT_SUSPENDED`: in `loginUser`
      ([`auth.controller.ts:422`](../server/src/auth/auth.controller.ts)), next to the `lock_until`
      check (line 448), and in `oidcCallback` (line 1713) where an existing user is signed in. Add
      the code to the README's list and to `apiErrorMessage` on the client.
- [ ] `authenticateToken` ([`auth.middleware.ts`](../server/src/auth/middlewares/auth.middleware.ts))
      already loads the user (line 60): refuse there too, as a backstop.
- [ ] Suspending does what `revokeAllSessions` does (line 799): `deleteAllUserRefreshTokens`, then
      `revokeSessionsBefore`. Refresh then fails, existing access tokens are refused, and sockets
      close with 4002. `revokeSessionsBefore` publishes `ws:revoke` itself, so this works from a
      script.
- [ ] Decide how a suspended person exercises their data rights (export, deletion). The simplest
      is by email to the contact address.

### 6.5 Actions as scripts

In `server/src/scripts/`, like `strip-deleted-messages.ts`, each with `--dry`:

- [ ] `moderation:list` — open reports, read-only.
- [ ] `moderation:remove-message <messageId> --report <id> --note "…"` — the same tombstone as
      `deleteMessage`, without the ownership check. Other clients see it on their next load; a
      live update would mean publishing the API's `ws:broadcast` message, which is optional.
- [ ] `moderation:suspend <userId> --report <id> --reason "…"` and `moderation:unsuspend`.
- [ ] `moderation:dismiss <reportId> --note "…"`.
- [ ] Each writes a moderation-action record (action, target, report, reason, time) and emails the
      affected person what was done, under which rule, and that they can reply to ask for a
      review. Skip that email where it would tip someone off about a criminal report.

### 6.6 Client

- [ ] "Report" in the message actions menu (`features/messages/components/message-actions/`) on
      other people's messages, and "Report user" next to "Block user" on the profile page
      (`features/user/components/page/`).
- [ ] A small dialog: reason, optional note, an "Also block this user" checkbox; then a toast.

### Verify

- [ ] Int specs for `POST /reports`: non-member refused; self-report refused; second open report
      on the same target refused; the snapshot survives the sender deleting the message.
- [ ] Suspension: login → 403 `ACCOUNT_SUSPENDED`; an existing access token → refused; refresh →
      fails.
- [ ] Purge: an attachment in an open report is not purged when its message is deleted; it is when
      the report closes.

### Then change

- [ ] Terms §6: "use Report on the message or profile, or email …".
- [ ] Privacy Policy §2: reports you make or that are made about you, including a copy of the
      reported message. §4: the operator sees reported content. §6: how long closed reports are
      kept.
- [ ] Bump `LEGAL.lastUpdated`.

---

## Step 7 — Processes (no code)

The pages promise these. None needs code; all need to exist before launch.

- [ ] **Requests inbox routine** — check the contact inbox regularly, verify identity from the
      account's address, answer within a month, and keep a log (received, what, answered).
- [ ] **Provider agreements** — accept the data processing terms that MongoDB Atlas, Cloudflare
      and your SMTP provider publish, and note how each covers transfers out of the EU/UK if your
      data leaves it.
- [ ] **Breach plan** — who decides, how you assess, who you tell. In the EU and UK the regulator
      must hear within 72 hours of you becoming aware, and users too when the risk to them is
      high. Log every breach, reported or not.
- [ ] **Child sexual abuse material** — never download, forward or open it beyond what is needed;
      preserve it; report it (in the US to NCMEC's CyberTipline — mandatory for US providers;
      elsewhere to the national police or an INHOPE hotline); then remove and suspend.
- [ ] **Copyright** — if you are US-based, register a DMCA designated agent with the US Copyright
      Office (it has to be renewed periodically) to get the safe harbour.
- [ ] **Backups** — decide how long database backups are kept, and add it to Privacy Policy §6:
      deleted data lingers in backups until they roll off.
- [ ] **Record of processing** — EU/UK services need a short table: what data, why, how long, who
      receives it. The Privacy Policy is most of it already.
- [ ] **EU/UK representative** — if you are outside the EU or UK but serve people there, check
      whether you need one.
- [ ] **App stores** (only if you ship the Capacitor app) — Apple: report and block, a way to
      filter objectionable content, published contact details (Step 6 covers reporting). Google
      Play: the Data safety form and a web link for account deletion.
- [ ] **Lawyer review** of all three pages once Step 0b is done.
