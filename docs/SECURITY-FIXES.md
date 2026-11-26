# Security fixes — what still needs doing

Working checklist from the security audit (first pass 2026-11-01, second pass 2026-11-10).
Finding IDs (H = high, M = medium, L = low, I = informational) match the audit. Steps are in fix
order: each one is reviewed before the next starts.

| Step | Topic | Status |
|---|---|---|
| 1 | Patch dependencies, Node 24 images, `.dockerignore`, proxy trust (H3, L20) | ✅ done — leftovers below |
| **2** | **Make uploads inert (H1, L1, L6, L13, L14\*, L21)** | **← current** |
| 2b | Signed OIDC transaction cookie (H4) | |
| 3 | Contain the media worker (H2, L11, L14, L21) | |
| 4 | Atomic rate limiter and missing limits (M2, M8, M12, L16, L19) | |
| 5 | Refresh-token reuse detection and logout (M1, L2, L12) | |
| 6 | Argon2id migration (M3, M4) | |
| 7 | Anti-enumeration and 2FA step-up (M5, M9, M10, M11, L19) | |
| 8 | WebSocket hardening (M6, L4, M13) | |
| 9 | Privacy (M7, L3, M14, M15, L15, L17) | |
| 10 | Cookies, CSRF, JWT, CSP, SMTP, infrastructure (L5, L7–L10, L18, L22, I5) | |
| 11–12 | End-to-end encryption: design, then build (I6, I7) | |

\* L14 (sharp limits) belongs to Step 3; L21 is partly covered by 2.3.

---

## Step 1 leftovers

Nothing here blocks Step 2.

- [ ] **Coolify: secrets "Available during build"** — switch every secret to runtime only
      (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `SESSION_SECRET`, `MONGO_URI`, the S3
      keys). Build-time variables become Docker build args and can end up in image layers or build
      cache. Nothing in the Dockerfiles needs them (`npm ci` + `tsc` only).
- [ ] **`.dockerignore`** — add `**/.env.*`, so a future `server/.env.production` cannot be baked
      into an image. `build` and `.cache` are still root-only patterns too.
- [ ] **Local `server/.env`** — clear `TRUSTED_PROXIES=`. It still holds three stale AWS addresses;
      locally nothing sits in front of the server.
- [ ] **Test account** — sign out all of `foo123@mail.com`'s sessions (or delete the account).
      Its password was typed in plain text earlier.
- [ ] *(optional)* **Direct-LAN spoof test** — from the laptop, run the `--resolve
      api-chat-app.zura156.xyz:443:192.168.0.100` curl test; the session must show the laptop's
      `192.168.0.x`, never the forged `203.0.113.77`.
- [ ] *(optional)* Bump the `@angular/build`, `@angular/cli` (`^22.0.7`) and `@angular/cdk`
      (`^22.0.5`) ranges in `package.json` to match what the lockfile already resolves (22.2.x).

### Production proxy setup (for reference — done)

| Hop | Trusts | Where it is set |
|---|---|---|
| Express | `10.0.1.0/24`, `fdd6:87d2:2665::/64` (Coolify Docker network) | `TRUSTED_PROXIES` in Coolify |
| Traefik `http` entrypoint | `10.0.1.1/32`, `fdd6:87d2:2665::1/128` (that network's gateway) | Coolify → Servers → Proxy |
| cloudflared (host systemd service → `http://localhost:80`) | Cloudflare edge | — |

Router forwards nothing on 80/443 (verified with tcpdump), so the tunnel is the only way in.

---

## Step 2 — make uploads inert ← current

**Why:** `dm-file` is the only upload context stored byte-for-byte (images go through `sharp`,
audio/video through `ffmpeg`, all with server-chosen types). Files are served from
`s3.zura156.xyz`, which is same-site with the app. A "text file" that is really HTML opens as a
page on your domain and can read the non-httpOnly `csrfToken` cookie.

Suggested order: **2.0 → 2.1 → 2.7**, then **2.3 + 2.4** (deploy together), then **2.2, 2.5, 2.6**.

### 2.0 Check production DM file uploads (possible regression from `1995e39`)

- [ ] Send a PDF in a DM on production.
- [ ] If it fails: remove the `ContentDisposition` block from presign now.

`@aws-sdk/s3-request-presigner` 3.1088 **signs** `Content-Disposition` by default
(`X-Amz-SignedHeaders=content-disposition;content-length;host`), so the PUT must send that exact
header. The client PUT in
[`upload.service.ts:162`](../src/app/features/upload/services/upload.service.ts) sends only
`Content-Type`.

### 2.1 Cloudflare response headers on the storage host (no code)

Protects files that are **already** stored, which no code change can.

- [ ] Cloudflare → **Rules → Transform Rules → Modify Response Header**, hostname equals
      `s3.zura156.xyz`:
  - [ ] Set `X-Content-Type-Options` = `nosniff`
  - [ ] Set `Content-Security-Policy` = `default-src 'none'; sandbox`
- [ ] Verify: `curl -sI "https://s3.zura156.xyz/<public-bucket>/<avatar key>"` shows both headers.

`<img>`, `<video>` and `<audio>` are unaffected (a response's CSP only applies when it is opened as
a document). Trade-off: Chrome will not preview a PDF in a sandboxed tab — files download instead,
which is what 2.3 does anyway.

### 2.2 Freeze `dm-file` bytes at confirm (L13)

The presigned PUT stays valid for its full lifetime after `confirm`, so bytes can be swapped
between the ClamAV scan and the copy (and between retries).

Where: `confirm` in [`upload.controller.ts`](../server/src/upload/upload.controller.ts)
(the `HeadObjectCommand` block). For `dm-file` only:

- [ ] `CopyObject` the temp key to `frozen/<uploadId>/original.<ext>` in the temp bucket (no
      presigned key can target it — every presigned key starts with a context name).
      `NoSuchKey`/404 → the existing "File not found in storage" 400. This replaces the 403
      `HeadObject` workaround for this context.
- [ ] Delete the original temp key.
- [ ] Set `upload.fileKey` to the frozen key before `save()`, so the job payload and
      `handleFailedJob`'s cleanup use it with no further changes.
- [ ] Other contexts keep `HeadObject` (their bytes are never scanned and always re-encoded).
- [ ] *(optional)* 1-day TTL on the temp bucket in SeaweedFS, for junk re-PUT to the old key.

Freezing in the API, not the worker, matters: a worker-side freeze would run again on each retry
and copy whatever is at the original key *by then*.

### 2.3 Worker: trust nothing from the upload

**a) Fail closed on an inconclusive scan** —
[`clamav.ts`](../server/src/utils/clamav.ts) (`isInfected: isInfected ?? false`)

- [x] `true` → infected, `false` → clean, anything else (`null`) → throw ("scan inconclusive"),
      so BullMQ retries. *(26 Nov, uncommitted: the error reads "ClamAV gave no verdict
      (reply …)". In compose, clamscan 2.4.0 resolved `isInfected: null` against a stand-in
      clamd that closed without a reply and one that replied `COMMAND READ TIMED OUT`; against
      the first, a clean `.txt` failed after 3 attempts in 15.3 s.)*

**b) Magic-byte check** — new `server/src/utils/file-signature.ts`, e.g.
`matchesDeclaredType(mimeType, firstBytes): boolean`, as a lookup table (no new dependency):

| Declared type | First bytes must be |
|---|---|
| `application/pdf` | `%PDF-` within the first 1024 bytes |
| `.doc` / `.xls` / `.ppt` | `D0 CF 11 E0 A1 B1 1A E1` (OLE2) |
| `.docx` / `.xlsx` / `.pptx` / `application/zip` | `50 4B 03 04` |
| `application/x-7z-compressed` | `37 7A BC AF 27 1C` |
| `application/x-rar-compressed` | `52 61 72 21 1A 07` |
| `text/plain`, `text/csv` | no `0x00` bytes, and valid UTF-8 (`new TextDecoder('utf-8', { fatal: true })`, decoded with `{ stream: true }` so a sample cut mid-character passes) |

- [x] Run it after a clean scan, on `GetObjectCommand({ ..., Range: 'bytes=0-4095' })` of the
      job's `fileKey` (the frozen key once 2.2 sets it). *Built in
      [`file.handler.ts`](../server/src/processors/handlers/file.handler.ts), not
      `processUpload`: the handler is dm-file's alone, and one `Upload` read serves this check
      and 2.3c's headers.*
- [x] On mismatch throw BullMQ's `UnrecoverableError` (a retry cannot change the bytes).
      *(Compose, 26 Nov: a ZIP declared `application/pdf` ended `failed` in 0.26 s,
      `attemptsMade` 1, "File content does not match application/pdf".)*
- [x] **Fix `handleFailedJob`** in [`worker.ts`](../server/src/worker.ts): `isFinalAttempt` must
      also be true when `err instanceof UnrecoverableError` — otherwise the upload stays
      "processing" forever. *(Now `processors/final-attempt.ts`, with its own spec.)*
- [x] Spec `server/src/tests/utils/file-signature.spec.ts`: a pass and a fail per row, plus HTML
      declared as `text/plain` (passes — 2.3c is what makes it harmless), ZIP declared as PDF
      (fails), empty buffer (fails), UTF-8 cut mid-character (passes).
- Behaviour change to know: `.txt` and `.csv` must now be UTF-8. A Windows-1252 CSV (an older
  Excel export, "René") or a UTF-16 text file fails as "File content does not match text/csv".
  So does an empty ZIP (`PK 05 06`, no entries).

**c) Server-set headers on the stored file** —
[`file.handler.ts`](../server/src/processors/handlers/file.handler.ts) (`CopyObjectCommand`)

- [x] ~~`MetadataDirective: 'REPLACE'`~~ **A streamed `GetObject` then `PutObject` instead.**
      Measured on SeaweedFS 4.13 (26 Nov, compose): a REPLACE copy keeps `x-amz-meta-*` (which is
      all `utils/quarantine.ts` sets) but keeps the source's Content-Type and sets no
      Content-Disposition, same bucket or across; a PUT sets both. The PUT takes
      `ContentLength` from the GET and streams: a 90 MiB file came back byte for byte (size and
      sha256), the worker peaking 36 MiB over idle.
- [x] `ContentType`: the declared type, plus `; charset=utf-8` for `text/plain` / `text/csv`.
- [x] `ContentDisposition: 'attachment; filename="file.<ext>"'` — generic name, never
      user input in a header.
- [x] Take the type from the `Upload` document (`Upload.findById(payload.uploadId)`), not
      `payload.mimeType`; re-check it is in `CONTEXT_CONFIG['dm-file'].allowedMimes`, else
      `UnrecoverableError` (part of L21).
- Compose, 26 Nov, through the real worker and a signed GET: HTML declared `text/plain` and PUT
  as `text/html` came back `text/plain; charset=utf-8`, `attachment; filename="file.txt"` (before
  this change: `text/html`, no disposition). A PDF came back `application/pdf` with its
  disposition. The canary's first run stayed ok.
- [x] **Files stored before this change**, which kept the type their client sent: both signers
      (`signPrivateUrl` and `GET /upload/signed-url/:id`) now sign a dm-file's GET with
      `ResponseContentType` and `ResponseContentDisposition`, from
      [`upload/file-types.ts`](../server/src/upload/file-types.ts). The type comes from the key's
      extension: today's (`original.txt`), or the one keys carried before 5 Aug 2026, the mime
      subtype's last dot segment, since the worker kept `path.extname` of presign's key
      (`original.plain`, and `original.document` for a .docx). Anything else is served as
      `application/octet-stream`, `attachment; filename="file"`. Images, video and voice are left
      inline. *(Compose, 26 Nov: objects stored as `text/html` under `original.txt` and
      `original.plain` came back through both signers as `text/plain; charset=utf-8` with
      `attachment`; the other old forms are unit-tested only. A URL with the parameters dropped
      or swapped got 403: they are inside the signature. Which old keys production holds is
      unread.)*
- Every dm-file now downloads as `file.<ext>`. The client's `<a download="originalName">` can't
  rename it: the storage host is another origin, where browsers ignore `download`. The original
  name could go in the signed disposition as `filename*=UTF-8''<percent-encoded>`, which can't
  break out of the header; not built.
- [ ] Verify: upload a `.txt` in a DM, take its signed URL from the network tab,
      `curl -s -o /dev/null -D - '<signed url>'` → `content-type: text/plain; charset=utf-8`
      and `content-disposition: attachment`. A GET, not `curl -I`: the URL is signed for GET,
      and the storage host answered a HEAD with 405.

### 2.4 Presign: bind the content type (H1)

Where: `presign` in [`upload.controller.ts`](../server/src/upload/upload.controller.ts).

- [x] Remove the `ContentDisposition` block (2.3c now sets it on the final object). *(Done in
      `24c3fc3`, as 2.0's fix.)*
- [ ] Pass `signableHeaders: new Set(['content-type'])` to `getSignedUrl` (verified:
      `SignedHeaders` becomes `content-length;content-type;host`). The client already sends
      `Content-Type: file.type`, the same value it presigned with — no client change.
- [ ] Verify: presign `text/plain`, PUT with `-H 'Content-Type: text/html'` → **403**;
      with `text/plain` → success.

### 2.5 `isOwnMediaUrl` accepts foreign URLs (L6)

Where: [`conversation.service.ts`](../server/src/messenger/services/conversation.service.ts)
(`isOwnMediaUrl`). `startsWith('/')` also matches `//evil.example/x.png`; the `s3Url` branch
accepts any bucket, including temp.

- [ ] Parse with `new URL()` inside try/catch.
- [ ] Require `url.origin === new URL(appConfig.s3Url).origin`.
- [ ] Require the path to start with `/<public bucket>/`.
- [ ] Reject a query string or fragment; drop the relative-path branch (the client only sends
      uploaded S3 URLs).
- [ ] Spec — rejected: `//evil.example/a.png`, `/\evil.example/a.png`,
      `https://s3.zura156.xyz.evil.example/...`, a temp-bucket URL, `javascript:alert(1)`, a
      non-string. Accepted: a real public-bucket group-avatar URL.

### 2.6 Tighten the app CSP (L1)

Where: [`security-headers.conf`](../security-headers.conf).

- [ ] In `img-src` and `media-src`, replace `https:` with `https://s3.zura156.xyz` (nothing in the
      client loads media from another host).
- [ ] Verify: open a conversation with images, video and voice messages — no CSP errors in the
      console.

### 2.7 Buckets are not anonymously readable (no code)

- [ ] From the laptop, each must print **403**:
  ```bash
  for b in <temp-bucket> <private-bucket> <quarantine-bucket>; do printf '%s: ' "$b"; curl -s -o /dev/null -w '%{http_code}\n' "https://s3.zura156.xyz/$b/"; done
  ```
  `200` on temp means unscanned files are linkable; `200` on private means every DM attachment is
  public.

### When Step 2 is done, hand over

- [ ] `curl -sI` output from 2.1 and 2.3c
- [ ] The 403s from 2.4 and 2.7
- [ ] Pushed commits (for diff review and running the specs)

---

## Step 2b — OIDC transaction cookie (H4)

The `oidcTx` cookie is unsigned JSON whose `intent` and `userId` are trusted. Any
`*.zura156.xyz` subdomain (see H1) can set ("toss") it, forcing the attacker's Google identity to be
linked to the victim's account — account takeover.

- [ ] Sign the cookie, or keep the transaction in Redis and put only a random id in the cookie.
- [ ] Bind a "link" intent to the session id that passed the password check.
- [ ] Use the `__Host-` cookie prefix (no `Domain`, `Path=/`, `Secure`).

## Step 3 — contain the media worker (H2, L11, L14, L21)

- [ ] `ffmpeg-static` 6.1.1 is old — update / use the system ffmpeg from the image.
- [ ] Demuxer allowlist, `-protocol_whitelist file`, time and size caps on ffmpeg/ffprobe.
- [ ] Stop buffering up to 500 MB in memory.
- [ ] Run the worker container as a non-root user.
- [ ] L14: `sharp` — set `limitInputPixels` and an input-format allowlist.
- [ ] L21: the worker trusts the job payload (`uploadId` → tmp path → `rm -rf`); validate it /
      re-read from the `Upload` document.

## Step 4 — rate limiting (M2, M8, M12, L16, L19)

- [ ] M2: make the HTTP rate limiter atomic (Lua script in Redis).
- [ ] M8: add a limiter to `DELETE /user/profile`.
- [ ] M12: limiter keys are built from the raw body before validation (up to 1 MB Redis keys,
      pre-auth) — validate/normalise first, hash the key; limiters currently **fail open**.
- [ ] L16: no limits on message send / conversation create; `tempId` is echoed unvalidated.
- [ ] L19: forgot-password has no per-IP budget.

## Step 5 — sessions and refresh tokens (M1, L2, L12)

- [ ] M1: refresh-token reuse detection is inverted — per-session token families plus a short
      grace window.
- [ ] L2: verify the token signature in logout.
- [ ] L12: logout never revokes the `sid` (old access tokens and open sockets live up to 1 h);
      add an absolute session lifetime and a per-user session cap.

## Step 6 — Argon2id migration (M3, M4)

- [ ] M3: move from bcrypt (72-byte truncation) to Argon2id (`crypto.argon2`, Node ≥ 24.7);
      NFKC-normalise passwords; dummy hash for unknown users; rehash on login.
- [ ] M4: keyed (HMAC) hashes for recovery codes; encrypt TOTP seeds at rest.

## Step 7 — account enumeration and step-up (M5, M9, M10, M11, L19)

- [ ] M5: uniform responses (anti-enumeration) across register / login / reset.
- [ ] M9: require 2FA step-up for email and password changes.
- [ ] M10: password reset/change must clear `pending_email` and `EMAIL_CHANGE` tokens.
- [ ] M11: pre-hijacking — the verify link is unauthenticated and auto-redeems on page load; OIDC
      auto-link keeps the old password and sessions.
- [ ] L19: login returns 423 before the password check; change-email returns 409 (both leak
      account state).

## Step 8 — WebSocket (M6, L4, M13)

- [ ] M6: set `maxPayload`; build typing/receipt payloads on the server.
- [ ] L4: participants-cache race.
- [ ] M13: no per-user socket cap, unlimited upgrades, client `type` used as the rate bucket,
      keyspace `SCAN` on every disconnect.

## Step 9 — privacy (M7, L3, M14, M15, L15, L17)

- [ ] M7 / L3: central redaction; consent for DMs and group adds; no full user directory; purge
      media when a message is deleted.
- [ ] M14: ghost removal — admin `remove` of a non-member pushes `conversation-leave` to anyone and
      the client navigates away.
- [ ] M15: `GET /user/blocked` is unredacted; presence broadcasts leak `last_seen` and reach blocked
      users; directory sorted by `updatedAt`.
- [ ] L15: `is_group` is not tied to member count; orphaned groups.
- [ ] L17: blocked users can still edit, send typing indicators and read receipts.

## Step 10 — cookies, CSRF, JWT, CSP, SMTP, infrastructure (L5, L7–L10, L18, L22, I5)

- [ ] L5, L7–L10: cookie, CSRF, JWT, CSP and SMTP hardening items from the first audit pass.
- [ ] L18: `mongoSanitize` / `hpp` are mounted before the body parsers (dead for bodies);
      validators accept arrays.
- [ ] L22: no MongoDB transactions where multi-document writes must be atomic.
- [ ] I5: all of `zura156.xyz` is one site — consider moving user content to a separate
      registrable domain.
- [ ] Coolify build-time secrets (see Step 1 leftovers).

## Steps 11–12 — end-to-end encryption (I6, I7)

Last, after everything above.

- [ ] Design (Signal protocol or MLS). Must account for:
  - I6: Cloudflare's edge injects a script into the HTML (Web Analytics) — a party that can modify
    the client can defeat E2EE.
  - I7: server features that need plaintext — `last_message` previews, system messages, export.
- [ ] Incremental build.

---

## Other known issues (not security steps)

- [ ] **CORS `allowedHeaders` lacks `X-CSRF-Retry`** — the client's CSRF retry fails cross-origin
      (`server/src/index.ts`, `cors({ allowedHeaders: ... })`).
- [ ] **`pickGithubEmail` TODO(human)** in
      [`oidc.service.ts`](../server/src/auth/services/oidc.service.ts) is unfinished.
