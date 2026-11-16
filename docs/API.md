# Chat App — Server API Reference

Everything a client needs to talk to the Express server in `server/`, written so the frontend can be
rebuilt in any framework. It covers the HTTP API, the session and CSRF envelope around it, the
upload pipeline, and the WebSocket protocol.

> Written from the server source at commit `202fdaa` (2026-11-01). Where this file and the code
> disagree, the code wins — `server/src/auth/auth.router.ts` and the files under
> `server/src/*/routers/` are the authoritative route lists. Section 12 lists server behaviour that
> is easy to get wrong, and the places where the current Angular client does.

---

## Contents

1. [Quick start for a new client](#1-quick-start-for-a-new-client)
2. [Transport and deployment constraints](#2-transport-and-deployment-constraints)
3. [Sessions, cookies and CSRF](#3-sessions-cookies-and-csrf)
4. [Errors](#4-errors)
5. [Rate limits](#5-rate-limits)
6. [Auth flows](#6-auth-flows)
7. [Endpoint reference](#7-endpoint-reference)
   - [7.1 Auth — `/auth`](#71-auth--auth)
   - [7.2 Two-factor — `/auth/2fa`](#72-two-factor--auth2fa)
   - [7.3 Google / GitHub — `/auth/oidc`](#73-google--github--authoidc)
   - [7.4 Users — `/user`](#74-users--user)
   - [7.5 Conversations — `/conversations`](#75-conversations--conversations)
   - [7.6 Messages — `/messages`](#76-messages--messages)
   - [7.7 Notifications — `/notifications`](#77-notifications--notifications)
   - [7.8 Uploads — `/upload`](#78-uploads--upload)
8. [Data models](#8-data-models)
9. [Upload pipeline, end to end](#9-upload-pipeline-end-to-end)
10. [WebSocket protocol](#10-websocket-protocol)
11. [Business rules the UI should mirror](#11-business-rules-the-ui-should-mirror)
12. [Known quirks and discrepancies](#12-known-quirks-and-discrepancies)

---

## 1. Quick start for a new client

The minimum a new frontend must do, in order:

1. **Serve the frontend from exactly `CLIENT_URL`.** The server uses it as the only CORS origin and
   rejects WebSocket upgrades from any other `Origin`. If you use Vite (default port 5173), either
   run it on 4200 or set `CLIENT_URL=http://localhost:5173` in `server/.env`.
2. **Send credentials on every API request.** Use `fetch(url, { credentials: 'include' })` or axios
   `withCredentials: true`. The session is entirely in cookies; there is no `Authorization` header.
3. **On boot, call `GET /auth/csrf`.** This seeds the `csrfToken` cookie.
4. **On every non-GET request, send `X-CSRF-Token: <value of the csrfToken cookie>`.** Read the
   cookie each time; the server rotates it on login and on refresh.
5. **Find out whether you are signed in:** `GET /user/profile` returns `200` if so and `401` if not.
6. **On a `401` from any endpoint except `/auth/login`, `/auth/logout` and `/auth/refresh`**, call
   `POST /auth/refresh` once (single-flight), re-read the CSRF cookie, and replay the request. If the
   refresh itself returns `401`, you are signed out.
7. **Once signed in**, open the WebSocket at `wsUrl` (the API's host and port, with the `ws://` or
   `wss://` scheme). The browser sends the cookie automatically. Then send
   `{"type":"user-status","status":"online"}`.
8. **Send messages over REST** (`POST /messages/:conversationId/send`) and receive them over the socket.
9. **Implement the email-link pages** listed in [§6.8](#68-frontend-routes-the-server-links-to). The
   server mails links that point at your frontend, not at the API.

---

## 2. Transport and deployment constraints

| | |
|---|---|
| Base URL | The API origin, e.g. `http://localhost:3000`. Routes are mounted at the root (`/auth`, `/user`, …), with no `/api` prefix. |
| WebSocket | The same host and port (`ws://localhost:3000`), on any path. |
| Body format | JSON (`Content-Type: application/json`), capped at 1 MB. |
| IDs | MongoDB ObjectIds (24 hex characters), except `uploadId`, which is a UUID v4. |
| Dates | ISO 8601 strings in UTC. |
| Health check | `GET /health-check` → `200 OK`, plain text. |
| Unknown route | `404 { "message": "Cannot GET /x", "code": "NOT_FOUND" }` |

### CORS

- `origin`: exactly `CLIENT_URL`, with `credentials: true`.
- `allowedHeaders`: `Content-Type`, `Authorization`, `X-CSRF-Token`. **Any other custom request
  header fails the preflight.** That includes the `X-CSRF-Retry` header the current Angular client
  adds, so don't copy it.
- `exposedHeaders`: `X-CSRF-Token`. No response actually sets this header. `Retry-After` and
  `RateLimit-*` are *not* exposed, so browser JavaScript cannot read them. Use the `retryAfter`
  field in the 429 body instead.

### Deployment rules

These are cookie constraints, not code you can work around in the client:

1. **Same site.** In production the cookies are `SameSite=None; Secure`, and browsers increasingly
   block cross-site cookies entirely. Put the frontend and the API on the same registrable domain
   (`app.example.com` + `api.example.com`) and serve both over HTTPS.
2. **The CSRF cookie must be readable by the frontend.** It is set with `Domain=COOKIE_DOMAIN`. For
   `app.example.com` + `api.example.com`, set `COOKIE_DOMAIN=example.com`. In development
   `localhost` covers both ports.
   *Fallback:* `GET /auth/csrf` also returns the token in its body, and that request always mints a
   fresh one. A client that cannot read cookies can call it again after every login and every
   refresh.
3. **Serve the API at the origin root.** The `refreshToken` cookie has `Path=/auth/refresh` and the
   OIDC cookie has `Path=/auth/oidc`. If a reverse proxy publishes the API under `/api` and strips
   that prefix, the browser sees `/api/auth/refresh`, which no longer matches the cookie path, so the
   cookie is never sent and refresh always fails.

---

## 3. Sessions, cookies and CSRF

### Cookies

| Cookie | HttpOnly | Path | Lifetime | Set when | Purpose |
|---|---|---|---|---|---|
| `accessToken` | yes | `/` | Matches the JWT expiry (`JWT_EXPIRES_IN`, default **1 h**) | A session is issued (login, 2FA login, OIDC sign-in, refresh) | Authenticates every request and the WS upgrade |
| `refreshToken` | yes | `/auth/refresh` | 7 days | Same as above | Only ever sent to `POST /auth/refresh`; rotated on every use |
| `csrfToken` | **no** | `/`, `Domain=COOKIE_DOMAIN` | 24 h | Any GET/HEAD/OPTIONS that arrives without one; `GET /auth/csrf`; every session issue or refresh | Double-submit CSRF token |
| `twoFactorChallenge` | yes | `/` | Cookie lives 10 min, **but the JWT inside expires in 5 min** | Password or OIDC sign-in on an account with 2FA | Identifies the half-signed-in account |
| `oidcTx` | yes | `/auth/oidc` | 10 min | `GET /auth/oidc/:p/start`, `POST /auth/oidc/:p/link` | OAuth state, PKCE verifier, nonce |

`SameSite` is `Lax` in development and `None` (with `Secure`) in production. `oidcTx` is always
`Lax`.

### Sessions

- Each sign-in mints a session id (`sid`). It stays the same across refresh-token rotation, and it is
  what `GET /auth/sessions` lists.
- An access token is refused if it was blacklisted (logout, or revoking your own session), if its
  session was revoked, or if it was issued before a bulk revocation ("sign out everywhere", password
  reset, email change, or removing the last 2FA factor).
- Reusing an already-rotated refresh token is treated as theft. **Every session the account has is
  revoked**, and the response says so (see `POST /auth/refresh`).

### CSRF (double-submit cookie)

All `POST`, `PUT`, `PATCH` and `DELETE` requests, including login, register and refresh, must carry
an `X-CSRF-Token` header equal to the `csrfToken` cookie. If it is missing or doesn't match:

```json
403 { "message": "Invalid CSRF token", "code": "CSRF" }
```

How to recover: call `GET /auth/csrf`, then replay the request once with the new token. A `403
CSRF` is not an authentication failure, so don't refresh or sign out on it.

---

## 4. Errors

### Response shapes

The intended shape is:

```jsonc
{
  "message": "Password: Use at least 8 characters. Username is already taken.",
  "code": "VALIDATION_FAILED",                    // optional
  "errors": [{ "field": "password", "msg": "Use at least 8 characters." }]   // optional
}
```

`message` is a complete sentence you can show as-is. `errors[]` breaks the same reasons down by
field (one entry per field), so a form can show each one under its input.

The shape is not uniform yet. A robust client should read `body.message ?? body.error ?? <fallback>`:

| Where | Shape |
|---|---|
| Validators, `errorMiddleware`, rate limiters | `{ message, code?, errors? }` (429s add `retryAfter`) |
| `authenticateToken`, `requireVerifiedEmail`, conversation membership check, `/upload/*` | `{ message, error }` (same text in both) |
| `unauthenticatedGuard` (login/register while signed in) | `{ error, code: "ALREADY_AUTHENTICATED" }`, with **no `message`** |
| Unexpected 500 | `{ message: "Something went wrong! Please try again later..." }`, plus `detail` when `NODE_ENV=development` |

### Codes

| `code` | Status | Meaning / what to do |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Show `message`, and attach `errors[]` to the matching form fields |
| `DUPLICATE` | 409 | A unique field is taken; `errors[0].field` names it |
| `EMAIL_NOT_VERIFIED` | 403 | Only when `REQUIRE_EMAIL_VERIFICATION=true`. Show a "verify your email" screen with a resend button |
| `RATE_LIMITED` | 429 | Wait `retryAfter` seconds if it is present |
| `CSRF` | 403 | Re-fetch the CSRF token and replay once |
| `ALREADY_AUTHENTICATED` | 403 | Login or register called while a live session exists; just go into the app |
| `NOT_FOUND` | 404 | Unknown route |

### Status codes used

`400` bad input · `401` not authenticated, wrong password or wrong code · `403` authenticated but not
allowed (not a member, not the group creator, blocked, CSRF) · `404` not found, including a user who
is hidden by a block · `409` conflict · `410` gone (a deleted message, an expired TOTP setup) ·
`423` account locked · `429` rate limited.

### `401` messages from the auth guard

`Access token required` · `Token expired` · `Invalid token` · `Token revoked` · `Session revoked` ·
`User not found`. All of them mean the same thing to a client: try one refresh.

---

## 5. Rate limits

There are two kinds.

**Window limiters**: a fixed window per key. The 429 body is
`{ message, code: "RATE_LIMITED" }`, with no `retryAfter`.

| Limiter | Applies to | Key | Limit |
|---|---|---|---|
| General | **every** route | user id if any access/refresh cookie is validly signed (expiry ignored), else IP | 1000 per 5 min signed in / 300 anonymous |
| Presign | `POST /upload/presign` | same | 120 per min signed in / 30 anonymous |

**Escalating limiters**: count every attempt on entry. When the allowance is spent, a cooldown
starts, and each later round gets the next, longer cooldown. Body:
`{ message: "Too many attempts. Try again in 15 minutes.", code: "RATE_LIMITED", retryAfter: 900 }`.
On the routes marked ✔, a successful verification resets the counter.

| Limiter | Routes | Key | Allowance / window | Cooldowns | Reset on success |
|---|---|---|---|---|---|
| login | `POST /auth/login` | email + IP | 5 / 15 min | 5 m → 15 m → 1 h | ✔ |
| register | `POST /auth/register` | IP | 5 / 1 h | 30 m → 3 h | ✘ |
| forgot | `POST /auth/forgot-password` | email | 3 / 1 h | 15 m → 1 h | ✘ |
| reset | `POST /auth/reset-password`, `POST /auth/confirm-email` | body user id + IP | 10 / 15 min | 15 m → 1 h | ✔ |
| account-token | `POST /auth/verify-email`, `POST /auth/unlock-account` | body user id + IP | 10 / 15 min | 15 m → 1 h | ✘ |
| resend | `POST /auth/resend-verification` | user | 3 / 1 h | 30 m | ✘ |
| changepw | `change-password`, `change-email`, `oidc/:p/link`, `DELETE identities/:p` | user | 5 / 15 min | 15 m → 1 h | ✔ |
| 2fa (code) | `login/2fa`, `2fa/confirm`, `2fa/email/confirm`, `DELETE 2fa*` | user, else challenge cookie, else IP | 5 / 15 min | 15 m → 1 h | ✔ |
| 2fa-email-send | `login/2fa/email`, `2fa/email/setup`, `2fa/email/send` | same | 10 / 1 h | 15 m → 1 h | ✘ |
| 2fa-setup | `2fa/setup` | user | 10 / 1 h | 15 m | ✘ |
| oidc-start | `GET oidc/:p/start` | IP | 20 / 15 min | 5 m → 15 m | ✘ — **redirects** to `/auth/login?error=rate_limited&retry_after=N` |
| oidc-callback | `GET oidc/:p/callback` | IP | 10 / 15 min | 5 m → 15 m → 1 h | ✘ — same redirect |

Email codes also have a fixed one-minute resend gap per account. A request inside the gap reports
success but sends nothing.

The WebSocket has its own per-type limits ([§10.4](#104-client--server-frames)).

---

## 6. Auth flows

### 6.1 Boot

```
GET  /auth/csrf                → seeds csrfToken
GET  /user/profile             → 200: signed in (store the user)
                                 401: POST /auth/refresh → 200: retry profile
                                                         → 401: show sign-in
if signed in:
  open WebSocket → send {type:"user-status", status:"online"}
  GET /notifications, GET /conversations, GET /conversations/muted
```

### 6.2 Register → verify

1. `POST /auth/register` → `201`. **No session is issued.** Sign in afterwards.
2. The server mails `CLIENT_URL/auth/verify-email?token=…&id=…`. Your page posts
   `{ token, id }` to `POST /auth/verify-email`.
3. When verification is enforced, an unverified account can still use `/auth/*` and `/user/*`. Every
   messaging route returns `403 EMAIL_NOT_VERIFIED`. Offer `POST /auth/resend-verification`.

### 6.3 Password sign-in

```
POST /auth/login {email, password}
  200 { message: "Login successful" }                         → signed in (cookies set)
  200 { two_factor_required: true, methods, default_method }  → show the code step
  401 Invalid credentials | 423 locked (retryAfter) | 429
```

Code step: `POST /auth/login/2fa { code, method? }`. Any enrolled factor works, and so does a
recovery code. If the user picks email and a code hasn't arrived, `POST /auth/login/2fa/email` sends
one. When email is the account's **only** factor, the code is mailed automatically at the password
step. You have **5 minutes**: after that, `login/2fa` answers `401 Start the sign-in again`.

Lockout: 10 consecutive wrong passwords lock the account for 30 minutes (`423`). The owner is mailed
an unlock link (`/auth/unlock-account?token&id`) and a reset link. A successful sign-in or reset
clears the lock.

### 6.4 Refresh

`POST /auth/refresh` takes no body; the cookie carries everything. It still needs the CSRF header.
On `200`, both auth cookies **and the `csrfToken` cookie** are rotated, so re-read the CSRF cookie
before replaying anything. Make refresh single-flight: if several requests fail at once, let one
refresh run and have the others wait for it.

| Response | Meaning |
|---|---|
| `200 { message: "Token refreshed successfully" }` | Replay the original request |
| `401 Refresh token required` / `Refresh token invalid or expired` / `Session revoked` | Signed out |
| `401 Token reuse detected. All sessions revoked.` | Signed out everywhere |

### 6.5 Sign out

`POST /auth/logout` deliberately works without a valid access token. Always call it, ignore its
result, then clear local state and close the socket.

### 6.6 Google / GitHub sign-in

These are **top-level browser navigations, not XHR**:

```
GET /auth/oidc/providers               → which buttons to render
window.location = API + /auth/oidc/google/start
   … provider …
API redirects the browser back to CLIENT_URL:
  /auth/oidc/callback                                   signed in → GET /user/profile, enter app
  /auth/login?two_factor=1&methods=totp,email&default=totp   → show code step (6.3)
  /auth/login?error=<code>[&retry_after=N]              → show error
```

Sign-in `error` codes: `oidc_unavailable`, `oidc_expired`, `oidc_failed`, `oidc_cancelled`,
`email_unverified` (the provider's email address is unverified), `link_required` (a local account
with that address exists but is unverified; sign in with a password and link the provider from
settings), `provider_in_use`, `rate_limited`.

A provider sign-in resolves the account like this: the account that already holds that identity;
otherwise the account whose verified address matches (linked automatically, and the owner is
emailed); otherwise a new verified account with **no password**. Password-gated actions on such an
account answer `400` with *"This account signs in with Google or GitHub and has no password yet. Set
one from Settings → Security first."* It gets its first password through `POST
/auth/forgot-password`. `GET /user/profile` returns `has_password: false` for it.

### 6.7 Linking a provider (signed in)

```
POST /auth/oidc/github/link {password}  → 200 { url } → window.location = url
… provider … → API redirects to CLIENT_URL:
  /settings/security?linked=github
  /settings/security?link_error=<oidc_expired|oidc_failed|oidc_cancelled|oidc_unavailable|identity_in_use|provider_in_use>
```

### 6.8 Frontend routes the server links to

Your frontend **must** implement these routes. Every emailed token is valid for **1 hour**, and
issuing a new link of the same type invalidates the old one.

| Frontend route | Query | What the page does |
|---|---|---|
| `/auth/verify-email` | `token`, `id` | `POST /auth/verify-email { token, id }` |
| `/auth/reset-password` | `token`, `id` | Ask for a new password, then `POST /auth/reset-password { token, userId: id, new_password }` |
| `/auth/unlock-account` | `token`, `id` | `POST /auth/unlock-account { token, userId: id }`. Note the body field is `userId`, not `id` |
| `/auth/confirm-email` | `token`, `id` | `POST /auth/confirm-email { token, id }` |
| `/auth/login` | `error`, `retry_after`, `two_factor`, `methods`, `default` | OIDC outcomes ([§6.6](#66-google--github-sign-in)) |
| `/auth/oidc/callback` | — | `GET /user/profile`, then enter the app. The SPA cannot see httpOnly cookies, so this page exists to notice the new session |
| `/settings/security` | `linked`, `link_error` | Show the outcome of linking a provider |

---

## 7. Endpoint reference

Legend: **Auth** — `public`, `session` (needs a valid `accessToken`), or `verified` (a session plus a
verified email when enforcement is on). Every mutating request also needs the CSRF header
([§3](#csrf-double-submit-cookie)).

### 7.1 Auth — `/auth`

#### `GET /auth/csrf` — public
Mints a CSRF token, sets the cookie, and returns it in the body.
`200 { "csrfToken": "9f2c…" }`

#### `POST /auth/register` — public, must not be signed in
```json
{ "email": "a@b.co", "username": "alice", "first_name": "Alice", "last_name": "Liddell", "password": "…" }
```
- `email` must be valid. It is stored lowercased and trimmed.
- `username`: 3–32 characters matching `^[a-zA-Z0-9._-]+$`, unique without regard to case.
- `first_name` and `last_name`: 1–64 characters.
- `password`: see [§11](#11-business-rules-the-ui-should-mirror). The server also checks it against
  breach data.

`201 { message: "User registered successfully", user: { id, first_name, last_name, username, email } }`
(the key is `id`, not `_id`). No cookies are set.
Errors: `400 VALIDATION_FAILED`, `400` breached password, `409 DUPLICATE` (`errors[0].field` is
`email` or `username`), `403 ALREADY_AUTHENTICATED`, `429`.

#### `POST /auth/login` — public, must not be signed in
`{ "email": "…", "password": "…" }`
- `200 { message: "Login successful" }`, and the session cookies are set.
- `200 { two_factor_required: true, methods: ["totp","email"], default_method: "totp" }`, and the
  `twoFactorChallenge` cookie is set.
- `401 { message: "Invalid credentials" }` (an unknown email gets the same answer)
- `423 { message: "Account temporarily locked…", retryAfter: <seconds> }`
- `400`, `403 ALREADY_AUTHENTICATED`, `429`

#### `POST /auth/login/2fa` — public, needs the challenge cookie
`{ "code": "123456", "method": "totp" | "email" }`. `method` is optional; without it every enrolled
factor is tried. Recovery codes (`ABCDE-FGH23`, case-insensitive, separators ignored) are always
accepted, and each works once.
`200 { message: "Login successful", methods, recovery_codes_remaining: 7, used_recovery_code: false }`,
and session cookies are set.
Errors: `401 Start the sign-in again` (no challenge, or it expired), `401 That code is not correct`,
`429`.

#### `POST /auth/login/2fa/email` — public, needs the challenge cookie
Emails a sign-in code (6 digits, valid 10 min, at most one per minute).
`200 { message: "A code is on its way" }`. Errors: `401 Start the sign-in again`,
`400 Email codes are not set up`, `429`.

#### `POST /auth/logout` — public
Blacklists the access token, deletes the refresh token, and clears the cookies.
`200 { message: "Logout successful" }`

#### `POST /auth/refresh` — public (refresh cookie)
See [§6.4](#64-refresh).

#### `POST /auth/forgot-password` — public
`{ "email": "…" }` → always `200 { message: "Password reset link sent if email exists." }`.
Mails `/auth/reset-password?token&id`. Existing sessions are left alone.

#### `POST /auth/reset-password` — public
`{ "token": "…", "userId": "<id from link>", "new_password": "…" }`
`200 { message: "Password reset successful." }`. **Every session is signed out** and the cookies are
cleared. A reset also clears an account lock.
Errors: `400 Invalid or expired reset token.`, `400` same as the old password, `400` fails the
policy or is breached, `404`, `429`.

#### `POST /auth/verify-email` — public
`{ "token": "…", "id": "…" }` → `200 { message: "Email verification successful." }`.
Errors: `400` invalid or expired, `404`, `409 Email already verified.`

#### `POST /auth/resend-verification` — session
`200 { message: "Verification email sent." }`. Errors: `409 Email already verified.`, `429`.

#### `POST /auth/unlock-account` — public
`{ "token": "…", "userId": "…" }` → `200 { message: "Account unlocked successfully." }`.
Errors: `400` invalid or expired, `404`, `409 Account is not locked.`

#### `POST /auth/change-password` — session
`{ "current_password": "…", "new_password": "…" }`
`200 { message: "Password changed.", signed_out_sessions: 2 }`. **Other** sessions are revoked; this
one stays signed in. A notification email is sent.
Errors: `400` no password on the account (OIDC-only), `401 Your current password is incorrect.`,
`400` same as the current one, fails the policy, or breached; `429`.

#### `POST /auth/change-email` — session
`{ "new_email": "…", "password": "…" }`
`200 { message: "Check new@x.co for a confirmation link.", pending_email: "new@x.co" }`.
Nothing changes until the user follows the link in the **new** inbox. The old address is notified.
Errors: `400` (OIDC-only account, already your address), `401` wrong password, `409` address in use,
`429`.

#### `POST /auth/confirm-email` — public
`{ "token": "…", "id": "…" }` → `200 { message: "Email address updated." }`. The new address counts
as verified. **Every session is signed out** and the cookies are cleared.
Errors: `400` invalid link or no pending change, `409` the address was taken in the meantime.

#### `POST /auth/cancel-email-change` — session
`200 { message: "Email change cancelled." }`

#### `GET /auth/sessions` — session
```json
{ "sessions": [
  { "id": "sid", "user_agent": "Mozilla/5.0 …", "ip": "203.0.113.4",
    "created_at": "…", "last_used_at": "…", "current": true }
] }
```

#### `DELETE /auth/sessions/:id` — session
`200 { message: "Session revoked" }`. That device's tokens are refused and its sockets are closed
with `4002`. If `:id` is the current session, the cookies are cleared too, so you are now signed out.
Errors: `404 Session not found`.

#### `DELETE /auth/sessions` — session
Signs out **every** session, **including this one**, and clears the cookies.
`200 { message: "All sessions signed out" }`

### 7.2 Two-factor — `/auth/2fa`

All of these require a session. The status object returned by several routes:

```ts
interface TwoFactorStatus {
  enabled: boolean;               // at least one factor is on
  methods: ('totp' | 'email')[];
  totp_enabled: boolean;
  email_enabled: boolean;
  totp_pending: boolean;          // setup started, not confirmed, not expired
  recovery_codes_remaining: number;
}
```

| Route | Body | Success | Notable errors |
|---|---|---|---|
| `GET /auth/2fa` | — | `TwoFactorStatus` | |
| `POST /auth/2fa/setup` | `{ password }` | `{ secret, otpauth_uri, expires_at }`. Render `otpauth_uri` as a QR code and show `secret` for manual entry. Expires after 10 min | `409` already on, `400`/`401` password |
| `POST /auth/2fa/confirm` | `{ code }` | `TwoFactorStatus & { recovery_codes: string[] }` | `400` no setup or wrong code, `409`, `410` setup expired |
| `POST /auth/2fa/email/setup` | `{ password }` | `{ sent_to, expires_in_seconds: 600 }` | `409` already on, `400`/`401` password |
| `POST /auth/2fa/email/confirm` | `{ code }` | `TwoFactorStatus & { recovery_codes: string[] }` | `400` wrong or expired code, `409` |
| `POST /auth/2fa/email/send` | — | `{ sent_to, expires_in_seconds }`. Mails a code for authorising a removal | `400` email factor not on |
| `DELETE /auth/2fa/totp` | `{ password, code }` | `TwoFactorStatus & { signedOut: boolean }` | `400` not on or wrong code, `401` password |
| `DELETE /auth/2fa/email` | `{ password, code }` | same | same |
| `DELETE /auth/2fa` | `{ password, code }` | same; turns everything off | same |

- `recovery_codes` holds **8 codes, shown once**. The list is only non-empty when the first factor is
  confirmed. Adding a second factor keeps the existing codes, so it returns `[]`.
- In a removal, `code` may come from **any** enrolled factor, or be a recovery code. For an
  email-only account, call `POST /auth/2fa/email/send` first.
- `signedOut: true` means the last factor was removed. **Every session, this one included, has been
  revoked**, so the client's next request will get a `401` and the refresh will fail. Treat it as a
  sign-out.
- These are `DELETE` requests with a JSON body. `fetch` supports that; check your HTTP library does.

### 7.3 Google / GitHub — `/auth/oidc`

| Route | Auth | Body | Response |
|---|---|---|---|
| `GET /auth/oidc/providers` | public | — | `{ providers: ("google" \| "github")[] }`, only the providers with credentials configured |
| `GET /auth/oidc/:provider/start` | public | — | `302` to the provider. **Navigate the browser to this URL; don't fetch it** |
| `GET /auth/oidc/:provider/callback` | public | — | `302` into the SPA ([§6.6](#66-google--github-sign-in)) |
| `POST /auth/oidc/:provider/link` | session | `{ password }` | `200 { url }`. Then navigate to `url` |
| `DELETE /auth/identities/:provider` | session | `{ password }` | `200 { message: "GitHub was disconnected." }`. `404` if none is connected |

`GET /user/profile` returns the providers already connected, as `providers: ["github"]`.

### 7.4 Users — `/user`

All routes require a **session**. A verified email is *not* required.

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/user/profile` | — | `SelfUser` (see §8) |
| PATCH | `/user/profile` | any of `{ username, first_name, last_name, bio }` | the updated `SelfUser` (without `has_password` and `providers`) |
| DELETE | `/user/profile` | `{ password }` | `200 { message }`. The account and everything it owns are deleted; cookies cleared |
| GET | `/user` | `limit`, `offset` | `{ users: PublicUser[], totalCount }`. Excludes yourself and anyone blocked in either direction, sorted by `updatedAt` desc |
| GET | `/user/search` | `q` (required) | `{ users: PublicUser[] }`, at most 50. MongoDB **full-word** text search: `ali` does **not** match `alice` |
| GET | `/user/privacy` | — | `{ privacy: PrivacySettings }` |
| PATCH | `/user/privacy` | any subset of `PrivacySettings` | `{ privacy: PrivacySettings }`. `400` for an unknown value or an empty body |
| GET | `/user/blocked` | — | `{ users: PublicUser[] }` |
| POST | `/user/:id/block` | — | `{ message: "User blocked" }`. Blocking twice is harmless. `400` for yourself, `404` |
| DELETE | `/user/:id/block` | — | `{ message: "User unblocked" }` |
| GET | `/user/storage` | — | `{ total_bytes, categories: [{ label, bytes, count, percent }] }`. The labels are Images, Videos, Audio, Documents, Profile media |
| GET | `/user/export` | — | A JSON file (`Content-Disposition: attachment`): `{ exported_at, profile, conversations, messages, uploads }`. Fetch it as a blob to trigger a download |
| GET | `/user/:id` | — | `PublicUser`, with privacy redaction applied, or `SelfUser` for your own id. **`404` if either side has blocked the other** |

`PATCH /user/profile` errors: `400` wrong type, empty, too long, or a bad username pattern;
`409 That username is already taken`. Avatars and cover photos are set through uploads ([§9](#9-upload-pipeline-end-to-end)),
not through this route.

`DELETE /user/profile` errors: `400` (no password on the account, or no password supplied),
`401 That password is not correct`.

### 7.5 Conversations — `/conversations`

All routes require **verified**. Every `/:id` route first checks that the conversation exists and
that you are in it: `400 Invalid conversation id`, `404 Conversation not found`,
`403 Access denied to this conversation`.

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/conversations` | `limit`, `offset` | `{ conversations: ConversationListItem[], totalCount }`, most recently active first |
| POST | `/conversations` | `{ conversation: { participants: string[], is_group?: boolean, group_name?: string } }` | `201` the raw conversation (participants as ids). Every participant, the creator included, also gets `conversation-join` |
| GET | `/conversations/search` | `q` | `{ conversations: ConversationListItem[], totalCount }`, at most 50. Case-insensitive substring match on the group name or another participant's username, first or last name |
| GET | `/conversations/find/:participantId` | — | `{ conversationId }` for an existing conversation containing exactly you and that user (normally the DM, though a two-member group also matches), or `404 Conversation not found!` (also returned when either side has blocked the other) |
| GET | `/conversations/muted` | — | `{ conversationIds: string[] }` |
| GET | `/conversations/:id` | — | `ConversationDetail`: participants **excluding yourself**, with richer fields. `last_message` is a bare id |
| PATCH | `/conversations/:id` | `{ group_name }` | The updated conversation. Groups only. Writes an INFO message and broadcasts `conversation-update` |
| DELETE | `/conversations/:id` | — | `{ message: "Conversation deleted successfully" }`. Groups: creator only. DMs: either party. Broadcasts `conversation-leave` to everyone |
| PATCH | `/conversations/:id/members` | `{ add?: string[], remove?: string[] }` | The conversation, participants excluding you. See the rules below |
| POST | `/conversations/:id/mute` | — | `{ message }`. `400` already muted |
| DELETE | `/conversations/:id/mute` | — | `{ message }`. `404` not muted. The unread count is recomputed and pushed |

**Creating:**
- The creator is added automatically, and duplicates are removed. The result must have 2–100 members,
  all of whom exist.
- `is_group: false` with exactly two members makes a DM, and DMs are unique: a second one returns
  `409 A conversation with these users already exists`. To open a chat with someone, try
  `GET /conversations/find/:userId` first and create only on `404`.
- Creating a conversation with someone you blocked, or who blocked you, returns `403`.
- `group_name` is trimmed and cut to 100 characters. `group_picture` only accepts a URL the server
  itself produced. The normal route is to create the group first, then upload a `group-avatar` with
  `resourceId` set to the conversation id.

**Members (`PATCH /:id/members`):**
- Groups only (`400` on a DM). Ids must be valid, existing users. The group can't exceed 100 members.
- The **creator** may add and remove anyone. Any other member may only *leave*, by sending
  `{ remove: [<own id>] }` and nothing else. Anything else from a non-creator returns `403 Only the
  person who created this conversation can do that`.
- You can't add someone who is blocked in either direction (`403`).
- Side effects: INFO messages, `conversation-leave` (sent to the remaining *and* the removed
  members), then `conversation-join`.

### 7.6 Messages — `/messages`

All routes require **verified**. `:id` is the **conversation id**, and membership is checked as in
§7.5.

| Method | Path | Query / body | Response |
|---|---|---|---|
| POST | `/messages/:id/send` | `{ content?, attachments?: [{ uploadId, originalName? }], tempId? }` | `201 Message` (private media URLs signed) |
| GET | `/messages/:id/messages` | `limit`, `offset` | `{ messages: Message[], totalCount }`, **newest first** |
| PATCH | `/messages/:id/messages/:messageId` | `{ content }` | the updated `Message` |
| DELETE | `/messages/:id/messages/:messageId` | — | `{ _id, conversation, deleted_at }` |
| GET | `/messages/:id/media` | `limit`, `offset` | `{ messages, totalCount }`: messages with at least one `dm-image` or `dm-video` attachment |
| GET | `/messages/:id/files` | `limit`, `offset` | `{ messages, totalCount }`: messages with at least one `dm-file` attachment |

**Sending:**
- You need non-empty `content` (at most 2000 characters, trimmed), at least one attachment, or both.
  The limit is 10 attachments.
- Each `uploadId` must be an upload **you** created (presigned and confirmed). Its `context`,
  `mimeType` and `fileSize` are read from the upload record, not from the request. The message
  `type` comes from the first attachment (`image`, `video`, `audio`, `file`), or is `text`.
- Attachments may still be `processing`. They are filled in later by `upload-ready`
  ([§9](#9-upload-pipeline-end-to-end)).
- `tempId` is an id you choose for optimistic UI. It is echoed in the **WebSocket** copy of the
  message, not in the HTTP response. The sender receives that copy too, so deduplicate by `_id` or
  `tempId`.
- In a DM where either side has blocked the other: `403 You can no longer send messages in this
  conversation`. In a group, the message is sent but not delivered to members on either side of a
  block.

**Edit and delete:** only your own messages; INFO messages can't be changed. Errors:
`400 Invalid message id`, `404`, `403 You can only change your own messages`,
`410 This message was deleted`, `400 System messages cannot be changed`. Editing changes only the
text and stamps `edited_at`. **Deleting is soft:** the message stays as a tombstone with `content`
removed, `attachments: []`, `type: "text"` and `deleted_at` set. Render it as "This message was
deleted".

**Reading:** pages are newest-first, so reverse them for display. Use `offset = loaded count` to page
backwards. Messages from users blocked in either direction are left out of the results.

### 7.7 Notifications — `/notifications`

One notification per (user, conversation) holds the **unread count** for that conversation. These
are badges, not a feed.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/notifications` | — | `{ notifications: Notification[] }`. Counts are recomputed before they're returned; muted conversations are left out |
| PATCH | `/notifications/seen` | `{ conversationId? }` | `{ message }`. Dismisses one conversation, or all of them if `conversationId` is omitted |

Counts are kept current over the socket (`notification` event). Reading a conversation, which sends
a `message-status` receipt, also clears its count.

### 7.8 Uploads — `/upload`

All routes require **verified**.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/upload/presign` | `{ context, mimeType, fileSize, resourceId? }` | `{ uploadId, presignedUrl, fileKey, expiresIn }` |
| POST | `/upload/confirm` | `{ uploadId }` | `{ ok: true }`. Queues processing |
| GET | `/upload/signed-url/:uploadId` | — | `{ variants }`: fresh 15-minute signed URLs for a private upload, or the plain URLs for one of your own public uploads |

`presign` errors: `400 Invalid context`, `400 .exe files are not accepted here. Allowed: …`,
`400 That file appears to be empty.`, `400 That file is 612MB, over the 500MB limit…`. For
`group-avatar`: `400` (no valid `resourceId`), `404`, `403` (not a member).
`confirm` errors: `400 A valid uploadId is required`, `404`, `400 Upload already confirmed`,
`400 File not found in storage. Upload it first.`
`signed-url` errors: `400 Upload not ready`, `403`, `404`, `409 Upload has no variants`.

---

## 8. Data models

These are TypeScript shapes as they appear on the wire. Fields marked `?` may be missing. Mongo
documents also carry `__v`, which you can ignore.

```ts
type ObjectId = string;
type ISODate = string;

interface ImageVariants { thumb?: string; medium?: string; large?: string } // 64 / 400 / 1200 px wide, webp

// ─── Users ───────────────────────────────────────────────────────────────────
type Visibility = 'everyone' | 'contacts' | 'nobody';   // contacts = shares a conversation with you

interface PrivacySettings {
  last_seen: Visibility;
  pfp_url: Visibility;        // also hides pfp_variants
  bio: Visibility;
  online_status: Visibility;  // hidden → status reads "offline"; "nobody" also stops user-status pushes
}

interface PublicUser {               // GET /user, /user/:id, /user/search, /user/blocked
  _id: ObjectId;
  first_name: string;
  last_name: string;
  username: string;
  bio?: string;                      // removed by privacy
  pfp_url?: string;                  // = pfp_variants.medium; removed by privacy
  pfp_variants?: ImageVariants;      // removed by privacy
  cover_url?: string;                // = cover_variants.large
  cover_variants?: ImageVariants;
  status: 'online' | 'offline' | 'away';
  last_seen?: ISODate;               // removed by privacy
  createdAt: ISODate;
}

interface SelfUser extends PublicUser {   // GET/PATCH /user/profile
  email: string;
  pending_email?: string;            // an email change awaiting confirmation
  is_email_verified: boolean;
  last_login?: ISODate;
  blocked_users: ObjectId[];
  privacy: PrivacySettings;
  has_password: boolean;             // GET only. false = OIDC-only account
  providers: ('google' | 'github')[];// GET only
}

// Users embedded in other objects carry only some fields, and privacy is NOT applied to them:
interface UserRef { _id: ObjectId; username: string; pfp_url?: string; pfp_variants?: ImageVariants }
interface UserRefFull extends UserRef {
  first_name: string; last_name: string; status?: string; last_seen?: ISODate;
}

// ─── Conversations ───────────────────────────────────────────────────────────
interface ReadReceipt {
  user_id: ObjectId;
  last_message_read_id?: ObjectId;   // this user has read up to and including this message
  read_at: ISODate;
}

interface ConversationBase {
  _id: ObjectId;
  is_group: boolean;
  group_name?: string;
  group_picture?: string;            // = group_picture_variants.medium (public URL)
  group_picture_variants?: ImageVariants;
  created_by?: ObjectId;             // the group admin. DMs have one too, but it grants nothing
  dm_key?: string;                   // "<idA>:<idB>" for DMs
  read_receipts: ReadReceipt[];
  createdAt: ISODate;
  updatedAt: ISODate;                // bumped by every new message: sort by this
}

interface ConversationListItem extends ConversationBase {   // GET /conversations, /search
  participants: UserRef[];           // INCLUDES yourself
  last_message?: LastMessage;
}

interface ConversationDetail extends ConversationBase {     // GET /conversations/:id
  participants: UserRefFull[];       // EXCLUDES yourself
  last_message?: ObjectId;
}

interface LastMessage {
  _id: ObjectId;
  content?: string;
  sender: UserRef;
  timestamp: ISODate;
  type: MessageType;
  attachments: Attachment[];         // variants here are NOT signed. Use for the preview label only
  deleted_at?: ISODate;
}

// The `conversation` inside conversation-* events (treat it as a full replacement):
//   conversation-join (create)    participants + created_by populated (UserRef + first/last name), no last_message
//   conversation-join (add)       participants (UserRef + first/last name) + last_message populated
//   conversation-update           participants (UserRefFull) + last_message populated
//   conversation-leave (remove)   participants (UserRef + first/last name) + last_message populated
//   conversation-leave (delete)   the raw document: participants are bare ids
// Unlike GET /conversations/:id, these all INCLUDE yourself in participants.

// ─── Messages ────────────────────────────────────────────────────────────────
type MessageType = 'info' | 'text' | 'image' | 'video' | 'audio' | 'file';

interface Message {
  _id: ObjectId;
  sender: UserRef;
  conversation: ObjectId;
  content?: string;                  // missing on tombstones and attachment-only messages
  type: MessageType;                 // 'info' = system narration ("alice left the conversation")
  status: 'sent' | 'delivered' | 'read' | 'failed';  // see §12. Prefer read_receipts
  attachments: Attachment[];
  timestamp: ISODate;
  edited_at?: ISODate;
  deleted_at?: ISODate;              // tombstone
  tempId?: string;                   // only on the WebSocket echo of your own send
}

type AttachmentContext = 'dm-image' | 'dm-video' | 'dm-audio' | 'dm-file';

interface Attachment {
  uploadId: string;                  // UUID
  context: AttachmentContext;
  mimeType: string;                  // of the ORIGINAL upload, not of the variants
  fileSize: number;                  // bytes, original
  status: 'processing' | 'ready' | 'failed' | 'infected';
  variants: AttachmentVariants | null;   // null while processing
  duration?: number | null;          // seconds, audio and video
  originalName?: string;             // at most 255 characters
}

type AttachmentVariants =
  | { thumb: string; medium: string; large: string }   // dm-image: webp, widths 64/400/1200
  | { original: string; thumbnail: string }            // dm-video: H.264 mp4 + webp poster
  | { original: string };                              // dm-audio: ogg/opus · dm-file: the file as uploaded

// ─── Notifications ───────────────────────────────────────────────────────────
interface Notification {
  _id: ObjectId;
  user: ObjectId;
  conversation: {                    // populated
    _id: ObjectId; group_name?: string; group_picture?: string;
    participants: ObjectId[]; is_group: boolean;
  };
  unread_count: number;
  seen: boolean;
  seen_at?: ISODate;
}
```

### Media URLs

- **Public** (avatars, group pictures, covers): plain `S3_ENDPOINT/<public-bucket>/<key>` URLs that
  can be stored and reused.
- **Private** (every `dm-*` attachment): every API response and every `upload-ready` event carries
  **pre-signed** URLs, valid for about 5–6 hours. They're aligned to the hour, so the same URL is
  reused within an hour and caches well. They are never stored server-side. If a page stays open
  long enough for them to expire, reload the message page or call
  `GET /upload/signed-url/:uploadId`, which returns 15-minute URLs.
- Media hosting supports HTTP Range requests, which `<video>` seeking needs.

---

## 9. Upload pipeline, end to end

### Limits per context

| `context` | Allowed MIME types | Max size | Bucket | Presign valid for | Variants produced | Used for |
|---|---|---|---|---|---|---|
| `avatar` | jpeg, png, webp, heic, heif | 20 MB | public | 5 min | `thumb`, `medium`, `large` | your `pfp_url` / `pfp_variants` |
| `cover-photo` | jpeg, png, webp, heic, heif | 20 MB | public | 5 min | `thumb`, `medium`, `large` | your `cover_url` / `cover_variants` |
| `group-avatar` | jpeg, png, webp, heic, heif | 20 MB | public | 5 min | `thumb`, `medium`, `large` | needs `resourceId` = conversation id (and membership) |
| `dm-image` | jpeg, png, webp, gif, heic, heif | 50 MB | private | 10 min | `thumb`, `medium`, `large` | message attachment |
| `dm-video` | mp4, quicktime, webm, x-msvideo, x-matroska | 500 MB | private | 30 min | `original` (mp4), `thumbnail` | message attachment |
| `dm-audio` | audio/webm, ogg, mp4, mpeg, wav | 25 MB | private | 10 min | `original` (ogg/opus) | message attachment, e.g. voice notes |
| `dm-file` | pdf, doc(x), xls(x), ppt(x), txt, csv, zip, 7z, rar | 100 MB | private | 10 min | `original` | message attachment; virus-scanned |

### Steps

```
1. POST /upload/presign { context, mimeType: file.type, fileSize: file.size, resourceId? }
     → { uploadId, presignedUrl, expiresIn }

2. PUT presignedUrl
     body: the raw file bytes
     headers: Content-Type: <exactly the mimeType you presigned>
     NO credentials, NO X-CSRF-Token: this request goes straight to S3, not to the API.
     Content-Length must equal fileSize (browsers set it automatically).
     For progress events use XMLHttpRequest (upload.onprogress); fetch has no upload progress.

3. POST /upload/confirm { uploadId }      → { ok: true }; status becomes "processing"

4a. dm-* contexts: POST /messages/:conversationId/send
       { content?, attachments: [{ uploadId, originalName: file.name }], tempId }
     Show the attachment as "processing" until an upload-ready / -failed / -infected event
     with that uploadId arrives (see below).

4b. avatar / cover-photo: wait for upload-ready with that uploadId (context "avatar" or
     "cover-photo"), then GET /user/profile to pick up the new URLs.
    group-avatar: every member gets conversation-update (with the new group_picture) and an
     INFO message "alice changed the group photo."
```

The record of a presigned upload that is never confirmed expires after 24 h. Uploading a new avatar,
cover or group picture deletes the one it replaces.

`upload-failed` and `upload-infected` reach other participants only through the message that
references the upload. **A failed avatar, cover or group-picture upload sends no event at all.**
Time out on the client (the worker retries 3 times with exponential backoff from 5 s), then
re-read the profile or conversation.

### Outcome events (WebSocket)

| Event | To | Payload |
|---|---|---|
| `upload-ready` | the uploader | `{ type, uploadId, context, resourceId, variants (signed), duration? }` |
| `upload-ready` | other participants (dm-* only) | `{ type, uploadId, variants (signed), duration? }` |
| `upload-failed` | every participant of the message (after 3 retries) | `{ type, uploadId, context }` |
| `upload-infected` | the uploader (`dm-file` only: media is re-encoded, not scanned) | `{ type, uploadId, context, viruses: string[] }` |
| `upload-infected` | other participants | `{ type, uploadId, context }` |

To apply one: find every attachment with that `uploadId` in loaded messages, set
`status = "ready" | "failed" | "infected"`, and for `ready` also set `variants` and `duration`.
Events missed while disconnected are not replayed. Reloading the message page always returns the
current state.

**The worker process (`npm run worker`) must be running**, or uploads stay `processing` forever.

---

## 10. WebSocket protocol

### 10.1 Connecting

```js
const ws = new WebSocket('ws://localhost:3000');   // wss:// in production; any path works
```

- **Auth comes from the `accessToken` cookie at the upgrade.** No auth message is needed. The server
  ignores an `authenticate` frame if you send one.
- The `Origin` header must equal `CLIENT_URL`. Otherwise the upgrade gets `403`.
- A missing, invalid, expired, blacklisted or revoked token gets `401`. The browser only reports a
  failed handshake as close code **1006**, so if the socket never opens, try `POST /auth/refresh`
  before reconnecting.
- The server pings every 30 s, and a client that doesn't answer is dropped. Browsers reply to pings
  automatically; there is no JSON heartbeat.

### 10.2 Close codes

| Code | Reason | Client action |
|---|---|---|
| `4001` | `Token expired`: the access token that opened the socket has expired. This happens every `JWT_EXPIRES_IN`, even on an active socket | `POST /auth/refresh`, then reconnect |
| `4002` | `Session revoked`: signed out remotely, password reset, etc. | Sign out locally. Don't reconnect |
| `1001` | `Server shutting down` | Reconnect with backoff |
| `1006` / other | Network drop or rejected handshake | Refresh if needed, then reconnect with backoff. Also retry on `online` and `visibilitychange` |

**After any reconnect, refetch** `GET /conversations`, `GET /notifications`, and the newest page of
the open conversation, merging by `_id`. The server keeps no queue of events missed while you were
disconnected.

### 10.3 After connecting

Send your presence. **The server does not mark you online when the socket opens:**

```json
{ "type": "user-status", "status": "online" }
```

### 10.4 Client → server frames

Only these three types are accepted. Anything else is logged and dropped. The server overwrites any
user id you send with the socket's real identity.

| `type` | Payload | Server behaviour | Limit (per 10 s) |
|---|---|---|---|
| `typing` | `{ conversation_id, is_typing: boolean, sender: { _id, username, pfp_variants? } }` | You must be a member. The frame is forwarded as-is to the **other** participants. `sender` is required and passed through verbatim, so send only public fields | 30 |
| `message-status` | `{ conversation_id, read_receipt: { user_id, last_message_read_id, read_at } }` | Read receipt: "I've read up to this message". The message must be in that conversation. Saves your receipt using server time, recomputes your unread count, broadcasts `message-status` to all participants, and in a DM sets that message's `status` to `read` | 60 |
| `user-status` | `{ status: "online" \| "offline" }` | `online` takes effect immediately. `offline` takes effect 30 s later unless you come back; a disconnect does the same. Contacts receive `user-status` unless your `online_status` privacy is `nobody` | 10 |

Any other `type` gets its own budget of 20 per 10 s (and is then rejected anyway), and unparseable
frames share one budget of 20. When you go over a budget, the server
drops the frame and replies (at most once per window per type) with:

```json
{ "type": "rate-limited", "message_type": "message-status", "retry_after": 7 }
```

Replay the **latest** `message-status` or `user-status` after `retry_after` seconds. Don't replay
`typing`.

Send `message-status` when the newest message is actually on screen. Skip it if your own receipt
already points at that message.

### 10.5 Server → client events

| `type` | Payload | Sent to | When |
|---|---|---|---|
| `message` | `{ message: Message }`; `message.tempId` is set on the echo of your own send | Every participant, sender included, minus block-filtered group members | A message is sent (REST), or the server writes an INFO message |
| `message-edited` | `{ conversation: ObjectId, message: Message }` | All participants | An edit |
| `message-deleted` | `{ conversation: ObjectId, message: { _id, deleted_at } }` | All participants | A delete; turn the message into a tombstone |
| `message-status` | `{ status: "read", conversation_id, read_receipt: { user_id, last_message_read_id, read_at } }` | All participants, the reader included | A read receipt; replace that user's entry in `conversation.read_receipts` |
| `typing` | `{ conversation_id, is_typing, sender }` | Other participants | A typing change. Clear it yourself after a few seconds in case a stop never arrives |
| `user-status` | `{ user_id, status: "online" \| "offline", last_seen: ISODate }` | Users who share a conversation | A presence change |
| `conversation-join` | `{ conversation, added_by?: UserRef \| ObjectId, added_users?: ObjectId[] }` | All current participants | Conversation created (no `added_users`), or members added. Insert or replace it in your list |
| `conversation-update` | `{ conversation }` | All participants | Renamed, or group picture changed. **Replace your whole local copy** |
| `conversation-leave` | `{ conversation, removed_users: ObjectId[], removed_by: UserRef \| ObjectId }` | Remaining *and* removed participants | Members removed, someone left, or the conversation was deleted (`removed_users` = everyone). If your id is in `removed_users`, drop the conversation and close it if it's open; otherwise update the member list |
| `notification` | `{ conversationId, unread_count, seen }` | That user | An unread count changed. Not sent for muted conversations |
| `upload-ready` / `upload-failed` / `upload-infected` | see [§9](#outcome-events-websocket) | | |
| `rate-limited` | `{ message_type, retry_after }` | That socket | See §10.4 |

An object id inside an event may arrive as a string or as a populated object (`added_by`,
`removed_by`, `sender`). Normalise with `typeof x === 'string' ? x : x._id`.

---

## 11. Business rules the UI should mirror

Validate on the client with the same numbers, so the user finds out before the round trip.

| Rule | Value |
|---|---|
| Username | 3–32 characters, `^[a-zA-Z0-9._-]+$`, unique **case-insensitively** |
| First / last name | 1–64 characters, trimmed |
| Bio | at most 500 characters |
| Password | **8–128 characters, any printable characters including Unicode, no composition rules.** The server also refuses common or predictable passwords, ones built from your username or email, and ones found in breach data. Mirror `src/app/features/auth/validators/password.validator.ts`, which shares a test vector table with `server/src/auth/services/password-policy.ts` |
| Message text | at most 2000 characters after trimming |
| Attachments per message | at most 10 |
| Group name | at most 100 characters (longer names are silently cut) |
| Conversation members | 2–100, creator included |
| Pagination | `limit` 1–100 (default 20), `offset` ≥ 0. Out-of-range values are clamped, not rejected |
| Search | users: full words, at most 50 results; conversations: the query is cut to 100 characters, at most 50 results |
| Email codes | 6 digits, valid 10 min, at most one send per minute, 5 guesses per code |
| Recovery codes | 8 per set, format `XXXXX-XXXXX`, each usable once |
| Account lockout | 10 consecutive wrong passwords → 30 min (`423`) |
| Presence | going offline takes effect 30 s after the last socket closes |
| Mutes | permanent until unmuted (no duration) |

Behavioural rules:

- **Group admin = `created_by`.** Only the admin can add or remove members or delete the group. Any
  member can rename it or leave it. For DMs, either party can delete.
- **Blocking is one-directional data with two-directional effects.** If *either* side blocked the
  other: they're hidden from user lists, search and profiles (404), you can't start a conversation
  or add them to a group, a DM refuses new messages, and in a group each stops seeing the other's
  messages. INFO messages are exempt.
- **Unread counts** come from your read receipt and from any dismissal (`PATCH
  /notifications/seen`). INFO messages and your own messages never count.
- **Email verification** is only enforced when the server has `REQUIRE_EMAIL_VERIFICATION=true`.
  Handle `403 EMAIL_NOT_VERIFIED` on any messaging or upload route.

---

## 12. Known quirks and discrepancies

Current server behaviour that a new client must work around, and places where the Angular client
gets it wrong. They are listed so you don't build on them by accident.

1. **`DELETE /auth/sessions` signs out *every* session, including the caller's**, and clears its
   cookies. Use `DELETE /auth/sessions/:id` per session if you need to keep the current one.
2. **The 2FA challenge lasts 5 minutes, not 10.** The cookie lives 10 minutes, but the JWT inside it
   expires after 5. After that, `/auth/login/2fa` answers `401 Start the sign-in again`.
3. **The socket has no auth message, and you can't send chat messages over it.** `authenticate` is
   ignored, because auth happens at the upgrade. `message` is server → client only: send messages
   with `POST /messages/:id/send`.
4. **Privacy settings are applied only to `/user/*` responses.** Users embedded in conversations
   (`GET /conversations/:id` includes `status`, `last_seen` and `pfp_url`) and message senders are
   not redacted. (This is on the security roadmap, step 9.)
5. **`typing` forwards `sender` verbatim** to the other participants. The Angular client currently
   sends its whole signed-in user object, email address included. Send only `_id`, `username` and
   `pfp_variants`. (Roadmap step 8.)
6. **`last_message.attachments[].variants`** in conversation lists are unsigned private URLs and
   won't load. Use `last_message.type` for the preview label ("📷 Photo").
7. **`message.status`** only becomes `read` on the exact message named by a receipt in a DM, and
   `delivered` is never set. For read state, use `conversation.read_receipts`: a message is read by
   user U if its `timestamp` ≤ the timestamp of U's `last_message_read_id`.
8. **Any group member can rename a group**, while membership and deletion are creator-only. The
   creator can leave, after which no one can manage the group's members.
9. **The error body shape varies** ([§4](#response-shapes)), and `ALREADY_AUTHENTICATED` has no
   `message`.
10. **CORS rejects custom request headers** other than `Content-Type`, `Authorization` and
    `X-CSRF-Token`. The Angular client's `X-CSRF-Retry` replay header is rejected cross-origin.
    `Retry-After` and `RateLimit-*` response headers are not exposed to JavaScript.
11. **User search is word-based** (MongoDB `$text`), while conversation search is substring-based.
    The same query can match in one and not the other.
12. **`POST /conversations` returns the unpopulated document** (participants as ids). Build your
    list entry from the `conversation-join` event, which is populated.
