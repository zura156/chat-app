#!/usr/bin/env bash
#
# End-to-end smoke test: a running API, a real MongoDB and a real Redis.
#
#   npm run build && node dist/src/index.js   # in one shell
#   npm run smoke                             # in another
#
# The unit and integration suites cover these paths at the service and model
# layer; nothing else drives them over HTTP with cookies, CSRF and the rate
# limiters in the way. That gap is where a change like making the password hash
# `select: false` hides — every test can pass while login is broken in the one
# configuration that ships.
#
# Notes for anyone extending this:
#   - Use `localhost`, not `127.0.0.1`. The CSRF cookie is issued with
#     `Domain=localhost`, and a client on a different host silently discards it,
#     which reads as a blanket 403.
#   - The limiters are Redis-backed and survive restarts. `redis-cli flushall`
#     between runs, or the third run in a row fails on 429s that are correct.
#   - Registration does not open a session, and the API refuses a login while
#     one is live. Both are deliberate; both are asserted below.
set -uo pipefail

API=${SMOKE_API:-http://localhost:3999}
SP=$(mktemp -d)
trap 'rm -rf "$SP"' EXIT
JAR_A="$SP/cookies-a.txt"
JAR_B="$SP/cookies-b.txt"
rm -f "$JAR_A" "$JAR_B"

STAMP=$(date +%s)
PASS_A='correct-horse-tangerine-lamp'
PASS_A_NEW='anvil poppy quartz drift vessel'
PASS_B='thunder plum vessel kite orbit'

pass=0; fail=0
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then printf '  ok   %-52s %s\n' "$1" "$2"; pass=$((pass+1));
  else printf '  FAIL %-52s got %s want %s\n' "$1" "$2" "$3"
       printf '       body: %s\n' "$(head -c 160 "$SP/body.json" 2>/dev/null)"; fail=$((fail+1)); fi
}

# The CSRF cookie is issued by middleware that runs before routing; /health-check
# is mounted above it, so prime the jar with a route that is not.
prime() { curl -s -o /dev/null -c "$1" -b "$1" "$API/user/profile"; }
csrf()  { grep -i csrfToken "$1" | awk '{print $7}' | tail -1; }

# req <jar> <method> <path> <json|-> -> prints HTTP status, body to $SP/body.json
req() {
  local jar=$1 method=$2 path=$3 body=${4:--}
  local args=(-s -o "$SP/body.json" -w '%{http_code}' -c "$jar" -b "$jar"
              -X "$method" -H 'Content-Type: application/json'
              -H "X-CSRF-TOKEN: $(csrf "$jar")" -H "Origin: http://localhost:4200")
  [ "$body" != "-" ] && args+=(-d "$body")
  curl "${args[@]}" "$API$path"
}

echo "── registration and login ─────────────────────────────────────────────"
prime "$JAR_A"
code=$(req "$JAR_A" POST /auth/register \
  "{\"first_name\":\"Ada\",\"last_name\":\"L\",\"username\":\"ada$STAMP\",\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A\",\"confirm_password\":\"$PASS_A\"}")
check "register a new account" "$code" "201"

code=$(req "$JAR_A" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A\"}")
check "log in (the select:false path)" "$code" "200"

JAR_X="$SP/cookies-x.txt"; rm -f "$JAR_X"; prime "$JAR_X"
code=$(req "$JAR_X" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"wrong-password-entirely\"}")
check "reject a wrong password" "$code" "401"

code=$(req "$JAR_A" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A\"}")
check "refuse a second login while signed in" "$code" "403"

echo
echo "── the password policy on a live route ────────────────────────────────"
prime "$JAR_B"
code=$(req "$JAR_B" POST /auth/register \
  "{\"first_name\":\"S\",\"last_name\":\"T\",\"username\":\"short$STAMP\",\"email\":\"short$STAMP@example.test\",\"password\":\"P@ssw0rd!\",\"confirm_password\":\"P@ssw0rd!\"}")
check "refuse a short but 'complex' password" "$code" "400"

code=$(req "$JAR_B" POST /auth/register \
  "{\"first_name\":\"K\",\"last_name\":\"W\",\"username\":\"kb$STAMP\",\"email\":\"kb$STAMP@example.test\",\"password\":\"qwertyuiopasdfgh\",\"confirm_password\":\"qwertyuiopasdfgh\"}")
check "refuse a keyboard walk" "$code" "400"

code=$(req "$JAR_B" POST /auth/register \
  "{\"first_name\":\"Grace\",\"last_name\":\"H\",\"username\":\"grace$STAMP\",\"email\":\"grace$STAMP@example.test\",\"password\":\"$PASS_B\",\"confirm_password\":\"$PASS_B\"}")
check "accept a passphrase with no composition rules" "$code" "201"

# Registration deliberately does not sign you in, so B needs a session of its own.
code=$(req "$JAR_B" POST /auth/login "{\"email\":\"grace$STAMP@example.test\",\"password\":\"$PASS_B\"}")
check "second account logs in" "$code" "200"

echo
echo "── authenticated reads ────────────────────────────────────────────────"
code=$(req "$JAR_A" GET /user/profile)
check "read own profile" "$code" "200"
hash_leaked=$(grep -c '\$2[aby]\$' "$SP/body.json" || true)
check "no password hash in the response" "$hash_leaked" "0"

code=$(req "$JAR_A" GET /notifications)
check "list notifications" "$code" "200"

echo
echo "── conversations and group leave ──────────────────────────────────────"
b_id=$(req "$JAR_B" GET /user/profile >/dev/null; python3 -c "import json;print(json.load(open('$SP/body.json')).get('_id',''))" 2>/dev/null)
a_id=$(req "$JAR_A" GET /user/profile >/dev/null; python3 -c "import json;print(json.load(open('$SP/body.json')).get('_id',''))" 2>/dev/null)

code=$(req "$JAR_A" POST /conversations \
  "{\"conversation\":{\"participants\":[\"$b_id\"],\"is_group\":true,\"group_name\":\"Smoke group\"}}")
check "create a group" "$code" "201"
conv=$(python3 -c "import json;d=json.load(open('$SP/body.json'));print(d.get('_id') or d.get('conversation',{}).get('_id',''))" 2>/dev/null)

code=$(req "$JAR_A" POST "/messages/$conv/send" '{"content":"hello from the smoke test"}')
check "send a message" "$code" "201"

code=$(req "$JAR_A" GET "/messages/$conv/messages?offset=0&limit=20")
check "read the thread back" "$code" "200"

code=$(req "$JAR_B" PATCH "/conversations/$conv/members" "{\"add\":[],\"remove\":[\"$b_id\"]}")
check "leave the group" "$code" "200"

code=$(req "$JAR_B" GET "/messages/$conv/messages?offset=0&limit=20")
check "a departed member loses access" "$code" "403"

echo
echo "── signing out everywhere ─────────────────────────────────────────────"
# A second device for the same account. Its access token is a self-contained
# JWT the server has never seen, so nothing about revoking the first session
# reaches it except the recorded cut-off — which is the whole point of this
# section.
JAR_A2="$SP/cookies-a2.txt"; rm -f "$JAR_A2"; prime "$JAR_A2"
code=$(req "$JAR_A2" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A\"}")
check "sign in on a second device" "$code" "200"

code=$(req "$JAR_A2" GET /user/profile)
check "second device works" "$code" "200"

# A second has to tick over between that sign-in and this revocation, or the
# assertion below is a coin toss.
#
# The cut-off is recorded in whole seconds because `iat` is — see the note on
# `Revocation` in token.service. A token minted in the same second as a
# revocation cannot be ordered against it, and the tie is deliberately resolved
# in the token's favour so that signing in again immediately after "sign out
# everywhere" is never refused. On localhost these three requests land inside
# one second often enough that the test failed for that reason alone, which
# reads as a revocation bug and is not one.
sleep 1

code=$(req "$JAR_A" DELETE /auth/sessions)
check "sign out everywhere from the first" "$code" "200"

# The token in the second jar has not expired and was never sent to the server
# to be blacklisted. Before the revocation record existed this still returned
# 200 for the rest of the access token's lifetime.
code=$(req "$JAR_A2" GET /user/profile)
check "the other device is refused immediately" "$code" "401"

# And signing in again has to work at once, or "sign out everywhere" locks the
# user out of their own account.
rm -f "$JAR_A"; prime "$JAR_A"
code=$(req "$JAR_A" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A\"}")
check "signing in again still works" "$code" "200"

echo
echo "── evicting one device ────────────────────────────────────────────────"
# The narrower version of the section above, and the more common one: you look
# at the security screen, see a device you do not recognise and end that session
# alone. Deleting its refresh tokens was all this used to do, which left the
# evicted device holding a working access token until it expired.
#
# No `sleep` here, unlike the two sections either side. This revocation is
# recorded against the session id rather than a moment, so there is no
# second-boundary tie to wait out.
JAR_A3="$SP/cookies-a3.txt"; rm -f "$JAR_A3"; prime "$JAR_A3"
code=$(req "$JAR_A3" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A\"}")
check "sign in on a device to be evicted" "$code" "200"

code=$(req "$JAR_A" GET /auth/sessions)
check "list the sessions" "$code" "200"
# The one that is not the caller's own — the row a user would click "sign out"
# on. `current` is what the security screen uses to tell them apart.
other_sid=$(python3 -c "import json;print(next((s['id'] for s in json.load(open('$SP/body.json'))['sessions'] if not s['current']),''))" 2>/dev/null)
check "  and can name the other one" "$([ -n "$other_sid" ] && echo yes)" "yes"

code=$(req "$JAR_A" DELETE "/auth/sessions/$other_sid")
check "end that session" "$code" "200"

code=$(req "$JAR_A3" GET /user/profile)
check "the evicted device is refused immediately" "$code" "401"

code=$(req "$JAR_A" GET /user/profile)
check "the device that did the evicting stays signed in" "$code" "200"

# Nor can it renew its way back in: its refresh entry is gone, and a rotated
# token would carry the same session id even if it were not.
code=$(req "$JAR_A3" POST /auth/refresh)
check "and cannot refresh its way back" "$code" "401"

# The other side of that check, and the one worth having: renewal is on the
# path of every session every fifteen minutes, so a revocation check that
# refused too much here would sign the whole user base out by degrees.
code=$(req "$JAR_A" POST /auth/refresh)
check "a live session still renews" "$code" "200"

code=$(req "$JAR_A" GET /user/profile)
check "  and the rotated token works" "$code" "200"

echo
echo "── changing a password ────────────────────────────────────────────────"
# Another device, so the asymmetry below can be seen: a password change signs
# out everywhere *except* the machine doing the changing. Signing the user out
# of the one they are typing on turns a routine action into a re-login, which
# is the friction that stops people rotating a password they think is exposed.
rm -f "$JAR_A2"; prime "$JAR_A2"
code=$(req "$JAR_A2" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A\"}")
check "sign in on a second device again" "$code" "200"

# Same second-boundary reason as the revocation section above.
sleep 1

code=$(req "$JAR_A" POST /auth/change-password \
  "{\"current_password\":\"$PASS_A\",\"new_password\":\"$PASS_A_NEW\",\"confirm_password\":\"$PASS_A_NEW\"}")
check "change password" "$code" "200"

code=$(req "$JAR_A" GET /user/profile)
check "the changing device stays signed in" "$code" "200"

code=$(req "$JAR_A2" GET /user/profile)
check "the other device is signed out" "$code" "401"

rm -f "$JAR_A"; prime "$JAR_A"
code=$(req "$JAR_A" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A_NEW\"}")
check "log in with the new password" "$code" "200"

rm -f "$JAR_A"; prime "$JAR_A"
code=$(req "$JAR_A" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A\"}")
check "old password no longer works" "$code" "401"

echo
echo "── two-factor sign-in ─────────────────────────────────────────────────"
# The authenticator path over HTTP. The email factor needs an SMTP sink to read
# the code back out, so it is covered by the integration suite instead
# (email-otp.service.int.spec.ts); everything below is reachable with nothing
# but curl and the TOTP generator the server already ships.
totp() {
  npx ts-node -e "import {generateCode} from './src/auth/services/totp.service';console.log(generateCode('$1'));" 2>&1 | tail -1
}

# The section above ends on a deliberately failed login, so this jar holds no
# session. Enrolment is behind one.
rm -f "$JAR_A"; prime "$JAR_A"
code=$(req "$JAR_A" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A_NEW\"}")
check "sign in before enrolling" "$code" "200"

code=$(req "$JAR_A" POST /auth/2fa/setup "{\"password\":\"$PASS_A_NEW\"}")
check "begin authenticator enrolment" "$code" "200"
SECRET=$(python3 -c "import json;print(json.load(open('$SP/body.json')).get('secret',''))" 2>/dev/null)

code=$(req "$JAR_A" POST /auth/2fa/confirm "{\"code\":\"$(totp "$SECRET")\"}")
check "confirm enrolment" "$code" "200"
RECOVERY=$(python3 -c "import json;print(json.load(open('$SP/body.json')).get('recovery_codes',[''])[0])" 2>/dev/null)

req "$JAR_A" POST /auth/logout >/dev/null
rm -f "$JAR_A"; prime "$JAR_A"
code=$(req "$JAR_A" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A_NEW\"}")
check "password alone no longer opens a session" "$code" "200"
required=$(python3 -c "import json;print(json.load(open('$SP/body.json')).get('two_factor_required',''))" 2>/dev/null)
check "  and says a second factor is needed" "$required" "True"

code=$(req "$JAR_A" GET /user/profile)
check "no session before the code" "$code" "401"

# A fresh step: the code spent confirming enrolment is burned, and RFC 6238
# §5.2 requires that it stay burned.
sleep 31
code=$(req "$JAR_A" POST /auth/login/2fa "{\"code\":\"$(totp "$SECRET")\",\"method\":\"totp\"}")
check "authenticator code completes the sign-in" "$code" "200"

code=$(req "$JAR_A" GET /user/profile)
check "session works after the code" "$code" "200"

# The regression this section exists for. Recovery codes are shown as
# `XXXXX-XXXXX` but were hashed exactly as typed, so entering one without the
# dash — which is how it reads off a printout — was refused, and five refusals
# locked the account for fifteen minutes. That lands precisely when the user has
# already lost their authenticator and has no other way in.
req "$JAR_A" POST /auth/logout >/dev/null
rm -f "$JAR_A"; prime "$JAR_A"
req "$JAR_A" POST /auth/login "{\"email\":\"ada$STAMP@example.test\",\"password\":\"$PASS_A_NEW\"}" >/dev/null
code=$(req "$JAR_A" POST /auth/login/2fa "{\"code\":\"$(echo "$RECOVERY" | tr -d '-')\"}")
check "a recovery code typed without its dash works" "$code" "200"

sleep 31
code=$(req "$JAR_A" DELETE /auth/2fa "{\"code\":\"$(totp "$SECRET")\",\"password\":\"$PASS_A_NEW\"}")
check "turn two-factor back off" "$code" "200"

echo
echo "──────────────────────────────────────────────────────────────────────"
echo "  $pass passed, $fail failed"
exit $((fail > 0))
