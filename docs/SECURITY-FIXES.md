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

- [x] Send a PDF in a DM on production. *(It failed in compose against SeaweedFS 4.13 with
      `SignatureDoesNotMatch`, 22 Nov, Z's upload canary. On production a file you sent in a DM
      uploaded on 24 Nov, on `24c3fc3`.)*
- [x] If it fails: remove the `ContentDisposition` block from presign now. *(Done in `24c3fc3`,
      deployed 23 Nov.)*

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

**Not set yet (27 Nov):** an unsigned GET on the public bucket came back with `content-type`,
`server: cloudflare` and `cf-cache-status: DYNAMIC`, and neither header. Until 2.7 is fixed this
rule is the only thing protecting a stored HTML file fetched without a signature.

### 2.2 Freeze `dm-file` bytes at confirm (L13)

The presigned PUT stays valid for its full lifetime after `confirm`, so bytes can be swapped
between the ClamAV scan and the copy (and between retries).

Where: `confirm` in [`upload.controller.ts`](../server/src/upload/upload.controller.ts)
(the `HeadObjectCommand` block). For `dm-file` only:

- [x] `CopyObject` the temp key to `frozen/<uploadId>/original.<ext>` in the temp bucket (no
      presigned key can target it — every presigned key starts with a context name).
      `NoSuchKey`/404 → the existing "File not found in storage" 400. This replaces the 403
      `HeadObject` workaround for this context. *(26 Nov, uncommitted: `freeze()`. The
      `HeadObject` stays in front of the copy, 403 workaround included: SeaweedFS 4.13 answers a
      copy from a missing key with 400 `InvalidArgument`, not 404, so only the HEAD can say "not
      uploaded". Any other copy failure is the existing 500.)*
- [x] Delete the original temp key. *(A failed delete is logged, not fatal: nothing names that
      key any more.)*
- [x] Set `upload.fileKey` to the frozen key before `save()`, so the job payload and
      `handleFailedJob`'s cleanup use it with no further changes. *(Saved before the delete, so
      the record never names an object that is gone. Read, not run, on the failure path:
      `handleFailedJob`, `moveToQuarantine`, the canary sweep and `upload-cleanup` all take the
      job's or the record's `fileKey`; the handlers build the stored key from context, user and
      upload id plus its extension, so a stored file stays under `dm-file/…`.)*
- [x] Other contexts keep `HeadObject` (their bytes are never scanned and always re-encoded).
- [x] *(added)* Claim the upload in one write before the copy:
      `findOneAndUpdate({ _id, userId, status: 'pending' }, { status: 'processing' })`, back to
      `pending` on any refusal so the client can upload and confirm again. Two confirms at once
      would otherwise both copy, the second perhaps bytes swapped in after the first, over the
      frozen key the first job is scanning. It covers every context, not only `dm-file`.
- [ ] *(optional)* 1-day TTL on the temp bucket in SeaweedFS, for junk re-PUT to the old key.
      *(Still your call. Measured: the presigned URL still PUTs after confirm, so a re-PUT leaves
      a stray object at the old key, which nothing names or reads.)*
- [ ] Production: the app identity copying and deleting inside the temp bucket. SYSTEM_CONTEXT.md
      gives it the same actions as compose's (Read, ReadAcp, Write, List); a bucket policy on
      production that compose lacks is unchecked. If it refuses the copy, every DM file's confirm
      answers 500 from the push on. Right after deploy: read `upload_canary` on sentinel's
      `/status` (it runs this path every 10 min but is still at digest level, so it won't page),
      send a PDF in a DM and open it, and check the API log has no "Failed to freeze".

Freezing in the API, not the worker, matters: a worker-side freeze would run again on each retry
and copy whatever is at the original key *by then*.

Verified in compose (26 Nov, `tests/failure/sentinel-canary-real/run.sh first` with `KEEP=1`:
SeaweedFS 4.13, ClamAV 1.4.6, the real API and worker). With the worker stopped: presign, PUT A,
confirm, then PUT B through the same presigned URL; then the worker started.

- **Before (`69e08fa`):** the stored file was **B**, the swapped bytes (1 MiB).
- **After:** **A**, at 90 MiB (confirm 242 ms with the copy; the worker 5.3 s) and at 1 MiB
  (confirm 38 ms). The frozen key was deleted after processing; B stayed at the old key.
- **The canary:** ok, "clean file ready, EICAR quarantined, 3 s after confirm", both records on
  `frozen/<id>/original.txt`.
- **Spec** `server/src/tests/upload/upload.confirm.int.spec.ts` (real Mongo; storage a map that
  answers as 4.13 did): 7 tests, two confirms at once among them (one copy, one job). The suite
  is 492 of 492.

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
- [x] **Download names.** The client's `<a download="originalName">` can't name a download: the
      storage host is another origin, where browsers ignore `download`. So the signers add the
      sender's name (the message attachment's `originalName`) as `filename*=UTF-8''…`, RFC 5987
      percent-encoding, which can't break out of the header; `filename` stays `file.<ext>`.
      `downloadName` in [`upload/file-types.ts`](../server/src/upload/file-types.ts) keeps the
      sender's stem but always the server's extension, since the extension is what a desktop
      opens a file with ("invoice.js" holding text arrives as "invoice.txt"); it keeps a path's
      last part, drops control and invisible format characters (a right-to-left override) and
      the characters Windows refuses, and stops at 100 characters. A file of unknown type gets
      no name. Uploads being processed are signed before any message names them, so they get
      `file.<ext>`. *(Compose, 26 Nov, through both signers: "Q3 report (final).js" came back
      as `filename*=UTF-8''Q3%20report%20%28final%29.txt`, a Georgian name intact, and
      `a"; filename="x.html` as `a%3B%20filename%3Dx.docx`. Not run in a browser: that it
      prefers `filename*` (RFC 6266 §4.3) is unverified here.)*
- [ ] Verify: upload a `.txt` in a DM, take its signed URL from the network tab,
      `curl -s -o /dev/null -D - '<signed url>'` → `content-type: text/plain; charset=utf-8`
      and `content-disposition: attachment; filename="file.txt"; filename*=UTF-8''<its name>`.
      A GET, not `curl -I`: the URL is signed for GET, and the storage host answered a HEAD with
      405. Then click it in the app: the browser should save it under its own name.

**Holds only behind a signature.** The compose results above, files stored before 2.3c coming
back as their real type and a URL with the overrides dropped getting 403, were measured with no
anonymous identity. Production's storage most likely serves an object to an unsigned GET (2.7).
The same URL without its query string would then return the stored type, `text/html` included,
with no disposition. The overrides protect signed links only, until 2.7 is fixed and 2.1 is set.

### 2.4 Presign: bind the content type (H1)

Where: `presign` in [`upload.controller.ts`](../server/src/upload/upload.controller.ts).

- [x] Remove the `ContentDisposition` block (2.3c now sets it on the final object). *(Done in
      `24c3fc3`, as 2.0's fix.)*
- [x] Pass `signableHeaders: new Set(['content-type'])` to `getSignedUrl` (verified:
      `SignedHeaders` becomes `content-length;content-type;host`). The client already sends
      `Content-Type: file.type`, the same value it presigned with — no client change.
      *(In `15092ab`. `upload.controller.int.spec.ts` now requires `content-type` in every
      context's signature; that row fails without the option. Every client path presigns and PUTs
      the same `file.type`. Voice recordings drop the codec before they become a File
      (`chatbox.component.ts`, `recordingFile`). Cropped avatars take their data URL's type. The
      server signs the exact whitelisted string. Chromium 158 and Firefox 161 sent an XHR PUT of a
      File with its type unchanged, for `text/plain`, `application/pdf`, `audio/webm`,
      `image/png` and `text/csv`. Safari isn't tested [A].)*
- [x] Verify: presign `text/plain`, PUT with `-H 'Content-Type: text/html'` → **403**;
      with `text/plain` → success. *(Compose, 27 Nov, SeaweedFS 4.13, the real presign at
      `15092ab`.)*

  | PUT | Result |
  |---|---|
  | as `text/html` | 403 `SignatureDoesNotMatch` |
  | with no type | 403 |
  | as `text/plain; charset=utf-8` | 403 |
  | as `text/plain` | 200, stored as `text/plain` |
  | avatar presigned as `image/png`, PUT as `image/svg+xml` | 403 |

  *Z's upload canary's first run stayed ok: "clean file ready, EICAR quarantined, 3 s after
  confirm".*

### 2.5 `isOwnMediaUrl` accepts foreign URLs (L6)

Where: [`own-media-url.ts`](../server/src/upload/own-media-url.ts), moved out of
`conversation.service.ts` so a pure spec can test it. Its one caller is `createConversation`'s
`group_picture`. `startsWith('/')` also matched `//evil.example/x.png`; the `s3Url` branch
accepted any bucket, including temp.

- [x] Parse with `new URL()` inside try/catch. *(The endpoint is parsed there too. An unset
      `S3_ENDPOINT` or `S3_BUCKET_PUBLIC` accepts nothing, rather than a prefix of `/` or `//`.)*
- [x] Require `url.origin === new URL(appConfig.s3Url).origin`. *(Implied by the prefix once the
      string is canonical: a mutant without it fails no row. Kept as the plain statement of
      intent.)*
- [x] Require the path to start with `/<public bucket>/`. *(As the string the image handler
      builds, `${s3Url}/${bucket}/`, with a key after it.)*
- [x] Reject a query string or fragment, checked on the raw string, since a bare `?` or `#`
      parses to an empty `search` or `hash`; drop the relative-path branch.
- [x] (added) The parsed URL must serialize back to the same string, so nothing is stored that a
      browser reads differently: `..` segments, backslashes, tabs and newlines, an upper-case host.
- [x] (added) No `%` at all. `..%2f` and `%2e%2e%2f` are one segment to the parser, so they
      survive the round trip; whether SeaweedFS decodes them into a separator is unknown [A], and
      the image handler's keys never contain a `%`.
- [x] Spec — [`own-media-url.spec.ts`](../server/src/tests/upload/own-media-url.spec.ts), 37
      rows. Rejected: every row listed here before, plus another port, `http:`, user info, the
      private bucket, `media-public-x`, the bucket root, the parser's rewrites, encoded slashes and
      backslashes, `data:` and five non-strings. Accepted: the thumb, medium and large URLs, built as the image handler builds
      them. Plus one row in `conversation.service.int.spec.ts`: create answers 400 "Invalid group
      picture" and stores nothing.

**Found while building it:** no client sends `group_picture`. Create's payload is `participants`,
`is_group` and `group_name`. The client's `updateConversation` could send one, but no caller
passes it, and the server's update takes only `group_name`. The picture is written by the worker
(`onGroupAvatarComplete`), from the URL it built itself. So "the client only sends uploaded S3
URLs" was wrong: it sends none, and the check guards a field only a hand-made request sets.
Taking `group_picture` out of create would close it outright; kept on your call (27 Nov), with the check above as the guard.

**Verified (27 Nov):** the server suite 530 of 530 with Mongo and Redis up; `tsc` clean.
Mutants, each run against both specs and then restored: the old `startsWith('/')` branch fails 5
rows, the int row included; without the round trip, 2 (`..` and the newline); without the
`?`/`#`/`%` test, 7; without `%` alone, 3; without the unset-config guard, 1; without the
key-length test, 1 (the bucket root); without the origin check, none. No compose run: nothing here
touches storage or the worker.

### 2.6 Tighten the app CSP (L1)

Where: [`security-headers.conf`](../security-headers.conf).

- [x] In `img-src` and `media-src`, replace `https:` with `https://s3.zura156.xyz` (nothing in the
      client loads media from another host). *(In `15092ab`. The server stores no third-party
      image: no OIDC `picture`, no link previews. Old `pfp_url` values on another host in
      production's data are possible and unchecked [A]; such a picture would stop loading.)*
- [ ] Verify: open a conversation with images, video and voice messages — no CSP errors in the
      console. *(Locally, 27 Nov: `nginx:alpine` with this repo's `nginx.conf` and this file;
      `nginx -t` ok, and the policy is on `/`, on a static asset and on the SPA fallback. In
      Chromium 158:*

  | Source | Result |
  |---|---|
  | the app's own icon, a `data:` image, a `blob:` image | loaded |
  | `https://example.com` as `img-src` | blocked |
  | `https://example.org` audio and video, as `media-src` | blocked |
  | the storage host | not blocked (the probe's key doesn't exist, so it errored) |

  *The real conversation is after deploy.)*

### 2.7 Buckets are not anonymously readable (no code)

- [x] From the laptop, each must print **403**:
  ```bash
  for b in <temp-bucket> <private-bucket> <quarantine-bucket>; do printf '%s: ' "$b"; curl -s -o /dev/null -w '%{http_code}\n' "https://s3.zura156.xyz/$b/"; done
  ```
  `200` on temp means unscanned files are linkable; `200` on private means every DM attachment is
  public.

  *(27 Nov: 403 on all four buckets, the public one included. But listing a bucket is the `List`
  action, and reading an object is `Read`, so this check doesn't test what its title says.)*

**Found on 27 Nov: production most likely serves objects to an unsigned GET by key.** An
unsigned GET of a key that doesn't exist answers **404 `NoSuchKey`** in all four buckets. SeaweedFS
4.13 in compose gives the same answers only when an `anonymous` identity holds `Read` on every
bucket.

| Anonymous identity | List a bucket | Existing object | Missing key |
|---|---|---|---|
| `Read` | 403 | 200 | 404 |
| `Read:media-public`, in the private bucket | 403 | 403 | 403 |
| `Read:media-public`, in the public bucket | 403 | 200 | 404 |
| none (compose's default) | 403 | 403 | 403 |

SYSTEM_CONTEXT.md records an `anonymous` identity on production whose earlier note "granted it Read
globally". If that's what it holds:
- Every DM attachment can be read by anyone who has its key, with no expiry.
- Every quarantined file can be too.
- So can every temp object, unconfirmed and unscanned uploads included.

The key is in every signed URL's path: in the recipient's browser history, in logs, in a
forwarded link. A user could also upload a file, never confirm it, and link it from
`s3.zura156.xyz` indefinitely, unscanned.

- [x] Decide it (you; read-only). Open a DM attachment in the app, copy its signed URL from the
      network tab, cut everything from `?`, and fetch it:
      `curl -s -o /dev/null -w '%{http_code}\n' '<url without the query>'`.
      **200 = exposed**, 403 = not. *(27 Nov: **200** for two `dm-image` objects in
      `media-private`, unsigned. Exposed.)*
- [x] Fix, if 200: in production's SeaweedFS `s3.json`, give `anonymous` only
      `["Read:<public-bucket>"]`, then restart the S3 gateway. Nothing in the app reads the other
      buckets unsigned:
      - attachments are signed on the way out (`media-url.service.ts`: "not readable without a
        signature"), and the client re-signs expired ones (`signed-media.service.ts`);
      - the conversation card shows only the file name;
      - uploads go through a presigned PUT;
      - the worker uses its own keys.
      Public avatars and group pictures keep loading.
      *(Done 27 Nov. Production's file is `base-config.json` in the SeaweedFS service's Coolify
      folder; the master's start command turns it into `/config.json` (`weed server -s3`), and
      nothing in the filer overrides it. Edited on disk with a backup beside it. If Coolify holds
      the file's content in the compose, a redeploy brings `Read` back: make the same change in
      Coolify's Storages too.)*
- [x] Verify the fix: the unsigned URL from the first box → **403**; a missing key in
      `<private-bucket>` → **403**, not 404; an avatar still loads in the app. *(27 Nov: both
      stripped DM image URLs 403; profile pictures 200. A missing key answers 403
      `AccessDenied` in the temp, private and quarantine buckets, and 404 only in the public
      one, as compose's `Read:media-public` did.)*

### When Step 2 is done, hand over

- [ ] `curl -sI` output from 2.1 and 2.3c
- [x] The 403s from 2.4 and 2.7 *(both in their sections)*
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
