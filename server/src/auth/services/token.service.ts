import { redisClient } from '../../config/redis';
import crypto from 'crypto';
import config from '../../config/config';
import { logger } from '../../utils/logger';

const REFRESH_TTL = 7 * 24 * 60 * 60;
const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

/*
 * `{userId}` is a Redis Cluster hash tag: only the text inside the braces is
 * hashed, so every key for one user lands in the same slot. That is what makes
 * the multi-key MULTI blocks and the rotate script below valid under Cluster —
 * without it they would be cross-slot operations and simply fail there.
 */
const userSetKey = (userId: string) => `refresh:set:{${userId}}`;
const tokenKey = (userId: string, hash: string) =>
  `refresh:{${userId}}:${hash}`;

/*
 * Each refresh token entry used to hold the string '1' — enough to answer "is
 * this token live?" and nothing else. The security screen therefore had no
 * session data to show and displayed a hardcoded list of invented logins
 * instead.
 *
 * The entry now carries the session it belongs to. `sid` is stable across
 * rotation, so a session keeps its identity as its token is exchanged; the
 * token hash is not usable as an id because it changes on every refresh.
 *
 * Only what the server observed directly is recorded: user agent and IP. No
 * geolocation — the fabricated version claimed cities, and inventing a location
 * from an IP would be the same lie with more steps.
 */
export interface SessionMeta {
  sid: string;
  userAgent?: string;
  ip?: string;
  createdAt: string;
  lastUsedAt: string;
}

const readMeta = (raw: string | null): SessionMeta | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionMeta;
    return parsed?.sid ? parsed : null;
  } catch {
    // Entries written before sessions existed hold '1'.
    return null;
  }
};

export const newSessionId = (): string => crypto.randomBytes(16).toString('hex');

export const storeRefreshToken = async (
  userId: string,
  token: string,
  meta: Omit<SessionMeta, 'createdAt' | 'lastUsedAt'>,
): Promise<void> => {
  const hash = hashToken(token);
  const now = new Date().toISOString();
  const payload: SessionMeta = { ...meta, createdAt: now, lastUsedAt: now };

  await redisClient
    .multi()
    .setEx(tokenKey(userId, hash), REFRESH_TTL, JSON.stringify(payload))
    .sAdd(userSetKey(userId), hash)
    .expire(userSetKey(userId), REFRESH_TTL)
    .exec();
};

export const validateRefreshToken = async (
  userId: string,
  token: string,
): Promise<boolean> => {
  // Presence is what makes a token valid; the value is session metadata now, so
  // comparing it against '1' would reject every token issued since.
  const result = await redisClient.get(tokenKey(userId, hashToken(token)));
  return result !== null;
};

/** Live sessions for a user, newest first. */
export const listSessions = async (
  userId: string,
): Promise<SessionMeta[]> => {
  const hashes = await redisClient.sMembers(userSetKey(userId));
  if (!hashes.length) return [];

  const values = await redisClient.mGet(
    hashes.map((h) => tokenKey(userId, h)),
  );

  const sessions: SessionMeta[] = [];
  const stale: string[] = [];

  values.forEach((raw, index) => {
    // A member whose key has expired is a session that ended; the set outlives
    // individual tokens, so it needs pruning as it is read.
    if (raw === null) {
      stale.push(hashes[index]);
      return;
    }
    const meta = readMeta(raw);
    if (meta) sessions.push(meta);
  });

  if (stale.length > 0) {
    await redisClient.sRem(userSetKey(userId), stale);
  }

  return sessions.sort(
    (a, b) =>
      new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
  );
};

/**
 * Ends one session by its id, leaving the user's other devices signed in.
 *
 * Both halves matter, for the reason set out under "Revoking sessions the
 * server cannot name" below: deleting the refresh tokens stops the session
 * renewing, and `markSessionRevoked` refuses the access token already sitting
 * in that browser — which the server has never seen and cannot enumerate.
 * Without the second half, evicting a device you do not recognise left it with
 * working API access, and an open socket, until its token expired.
 */
export const revokeSession = async (
  userId: string,
  sid: string,
): Promise<boolean> => {
  const hashes = await redisClient.sMembers(userSetKey(userId));
  if (!hashes.length) return false;

  const values = await redisClient.mGet(
    hashes.map((h) => tokenKey(userId, h)),
  );

  const doomed = hashes.filter((_, index) => {
    const meta = readMeta(values[index]);
    return meta?.sid === sid;
  });

  if (doomed.length === 0) return false;

  /*
   * Before the delete rather than after. If the process dies between the two,
   * this order leaves a session that is refused everywhere with a stale
   * refresh entry behind it; the other order leaves one that looks ended and
   * still works. A rotated refresh token keeps its `sid`, so even the access
   * token minted from that stale entry is refused.
   */
  await markSessionRevoked(userId, sid);

  await redisClient
    .multi()
    .del(doomed.map((h) => tokenKey(userId, h)))
    .sRem(userSetKey(userId), doomed)
    .exec();

  return true;
};

/**
 * Ends every session except the one named, and reports how many it ended.
 *
 * A password change has to invalidate the other devices — that is most of the
 * point of changing it — but signing the user out of the device they are
 * standing at as well turns a routine action into a re-login, which is exactly
 * the friction that stops people rotating a password they think is exposed.
 * `deleteAllUserRefreshTokens` cannot express "all but one", so this walks the
 * set and keeps the caller's own entry.
 */
export const revokeOtherSessions = async (
  userId: string,
  keepSid: string | null,
): Promise<number> => {
  const hashes = await redisClient.sMembers(userSetKey(userId));
  if (!hashes.length) return 0;

  const values = await redisClient.mGet(hashes.map((h) => tokenKey(userId, h)));

  const doomed = hashes.filter((_, index) => {
    const meta = readMeta(values[index]);
    // A member whose value has expired is already dead; dropping it here keeps
    // the set from accumulating tombstones.
    if (!meta) return true;
    return !keepSid || meta.sid !== keepSid;
  });

  if (doomed.length === 0) return 0;

  await redisClient
    .multi()
    .del(doomed.map((h) => tokenKey(userId, h)))
    .sRem(userSetKey(userId), doomed)
    .exec();

  return doomed.length;
};

// Atomic rotate via Lua: if old token exists → delete it + store new one
// If old token does NOT exist (reuse detected) → delete entire family
// The rotated entry inherits the old one's session metadata with lastUsedAt
// advanced, so a session survives token rotation as the same session. ARGV[5]
// is the fallback for entries that predate sessions and hold '1'.
/*
 * All keys this script touches share the `{userId}` hash tag, so Redis Cluster
 * routes them to one slot and the script is legal there. The family-wipe branch
 * builds key names at runtime — unavoidable, since the set's members are only
 * known once it is read — and that is only safe because the tag guarantees
 * every one of them hashes to the slot the declared KEYS already pinned.
 */
const ROTATE_SCRIPT = `
local old = KEYS[1]
local new = KEYS[2]
local set = KEYS[3]
local oldHash = ARGV[1]
local newHash = ARGV[2]
local ttl = tonumber(ARGV[3])

local existing = redis.call('GET', old)
if not existing then
  -- Reuse detected: wipe entire token family
  local members = redis.call('SMEMBERS', set)
  for _, h in ipairs(members) do
    redis.call('DEL', 'refresh:{' .. ARGV[4] .. '}:' .. h)
  end
  redis.call('DEL', set)
  return 0
end

local carried = existing
if existing == '1' then
  carried = ARGV[5]
end

redis.call('DEL', old)
redis.call('SREM', set, oldHash)
redis.call('SETEX', new, ttl, carried)
redis.call('SADD', set, newHash)
redis.call('EXPIRE', set, ttl)
return 1
`;

// Returns true = rotated OK, false = reuse detected (all sessions wiped)
export const rotateRefreshToken = async (
  userId: string,
  oldToken: string,
  newToken: string,
  observed?: { userAgent?: string; ip?: string },
): Promise<boolean> => {
  const oldHash = hashToken(oldToken);
  const newHash = hashToken(newToken);
  const now = new Date().toISOString();

  const fallback: SessionMeta = {
    sid: newSessionId(),
    userAgent: observed?.userAgent,
    ip: observed?.ip,
    createdAt: now,
    lastUsedAt: now,
  };

  const result = await redisClient.eval(ROTATE_SCRIPT, {
    keys: [
      tokenKey(userId, oldHash),
      tokenKey(userId, newHash),
      userSetKey(userId),
    ],
    arguments: [
      oldHash,
      newHash,
      String(REFRESH_TTL),
      userId,
      JSON.stringify(fallback),
    ],
  });

  if (result !== 1) return false;

  // Advancing lastUsedAt (and refreshing what the server can observe) is done
  // here rather than in Lua, which has no JSON parser available by default.
  const raw = await redisClient.get(tokenKey(userId, newHash));
  const meta = readMeta(raw);
  if (meta) {
    await redisClient.setEx(
      tokenKey(userId, newHash),
      REFRESH_TTL,
      JSON.stringify({
        ...meta,
        userAgent: observed?.userAgent ?? meta.userAgent,
        ip: observed?.ip ?? meta.ip,
        lastUsedAt: now,
      }),
    );
  }

  return true;
};

/** The session id attached to a live refresh token, if it has one. */
export const sessionIdForToken = async (
  userId: string,
  token: string,
): Promise<string | null> => {
  const raw = await redisClient.get(tokenKey(userId, hashToken(token)));
  return readMeta(raw)?.sid ?? null;
};

export const deleteRefreshToken = async (
  userId: string,
  token: string,
): Promise<void> => {
  const hash = hashToken(token);
  await redisClient
    .multi()
    .del(tokenKey(userId, hash))
    .sRem(userSetKey(userId), hash)
    .exec();
};

export const deleteAllUserRefreshTokens = async (
  userId: string,
): Promise<void> => {
  const sKey = userSetKey(userId);
  const hashes = await redisClient.sMembers(sKey);
  if (!hashes.length) return;
  const keys = hashes.map((h) => tokenKey(userId, h));
  await redisClient.del([...keys, sKey]);
};

export const blacklistAccessToken = async (
  token: string,
  expiresAt: number,
): Promise<void> => {
  const ttl = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  if (ttl > 0)
    await redisClient.setEx(`blacklist:${hashToken(token)}`, ttl, '1');
};

export const isAccessTokenBlacklisted = async (
  token: string,
): Promise<boolean> => {
  return (await redisClient.get(`blacklist:${hashToken(token)}`)) === '1';
};

/* ── Revoking sessions the server cannot name ──────────────────────────────
 *
 * Deleting refresh tokens ends the ability to *renew* a session, and
 * blacklisting an access token ends that one token. Neither reaches the access
 * tokens already sitting in other browsers: they are self-contained JWTs, the
 * server never saw them, and they stay cryptographically valid until they
 * expire. So "sign out everywhere" left every other device with working API
 * access for up to a full access-token lifetime — an hour by default. On an
 * account signed out *because* it was compromised, that is the hour that
 * matters.
 *
 * A blacklist cannot fix this, because it is keyed by a token the server does
 * not have. What it can record is a moment: everything issued to this user
 * before instant T is no longer honoured. One key per user, compared against
 * the `iat` every access token already carries.
 *
 * `keepSid` exists for the one flow that must not sign the caller out.
 * Changing a password has to invalidate the other devices — that is most of
 * the point — but not the one being typed on, and the epoch alone cannot tell
 * them apart. Exempting by session id also sidesteps a rounding problem: `iat`
 * has one-second resolution, so a token minted in the same second as the
 * revocation cannot be ordered against it by timestamp alone.
 */

const revocationKey = (userId: string) => `revoked:{${userId}}`;

/*
 * The other shape this comes in: ending one named session while the user's
 * other devices stay signed in — evicting a device from the security screen
 * that you do not recognise, which is the more common way an intruder is
 * actually thrown out.
 *
 * The epoch above cannot express it. It is keyed by user, so reaching for it
 * here would sign out every device instead of the one chosen. This is keyed by
 * the session, and needs no timestamp: a `sid` is minted per login and survives
 * refresh rotation, so every token carrying it belongs to the session being
 * ended, whenever it was issued.
 *
 * That also sidesteps the same-second tie the epoch has to live with. Signing
 * in again mints a *new* session id, which this key cannot match, so there is
 * no legitimate token for it to catch by accident and the comparison can be
 * exact.
 *
 * The `{userId}` hash tag is the same one the keys above use, so a revocation
 * check can read both in one MGET rather than a cross-slot pair.
 */
const sessionRevocationKey = (userId: string, sid: string) =>
  `revoked:sid:{${userId}}:${sid}`;

interface Revocation {
  /**
   * Unix **seconds**, and deliberately the same resolution as `iat`.
   *
   * A JWT's `iat` is whole seconds, so a token minted in the same second as a
   * revocation cannot be ordered against it. Recording milliseconds and
   * comparing `iat * 1000` looks more precise and is worse: the token appears
   * to predate the revocation and is refused, so signing in again immediately
   * after "sign out everywhere" hands back a session that 401s on its very
   * first request — the user is told they are logged in and then nothing
   * works.
   *
   * Comparing whole seconds with a strict `<` resolves the tie the safe way.
   * The cost is that a token issued earlier in the *same second* as the
   * revocation survives it — under a second of exposure, against an attacker
   * who would have had to obtain a token inside that second — and the gain is
   * that a legitimate sign-in is never refused.
   */
  at: number;
  /** The one session allowed to survive, if any. */
  keepSid?: string;
}

/**
 * The `1h` / `30m` / `7d` / `3600` forms jsonwebtoken accepts, as seconds.
 *
 * Anything it cannot read falls back rather than throwing, and the fallback is
 * generous on purpose: this only sizes a TTL, and an over-long record is
 * harmless where a short one would let a revoked token outlive its revocation.
 */
export const durationToSeconds = (value: string, fallback: number): number => {
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(String(value).trim());
  if (!match) return fallback;
  const unit = (match[2] ?? 's').toLowerCase() as 's' | 'm' | 'h' | 'd';
  return Number(match[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
};

/*
 * The record only has to outlive the last access token that predates it —
 * after that every such token has expired on its own and the comparison is
 * moot. A minute of slack covers clock skew between the API and Redis.
 *
 * Tracks `JWT_EXPIRES_IN`, so shortening the access token shortens this too.
 */
export const REVOCATION_TTL =
  durationToSeconds(config.jwtExpiresIn, 60 * 60) + 60;

/**
 * Refuses every access token issued to this user before now.
 *
 * Call alongside deleting their refresh tokens, not instead of it: this stops
 * the tokens already in the wild, that stops new ones being minted.
 */
export const revokeSessionsBefore = async (
  userId: string,
  keepSid?: string | null,
): Promise<void> => {
  const record: Revocation = { at: Math.floor(Date.now() / 1000) };
  if (keepSid) record.keepSid = keepSid;

  await redisClient.setEx(
    revocationKey(userId),
    REVOCATION_TTL,
    JSON.stringify(record),
  );

  /*
   * A socket authorises once, at the handshake, so one already open would
   * otherwise keep delivering messages to a revoked device until its token
   * expired — the same hour, on the more sensitive channel. The sockets live
   * in the API processes; this runs anywhere. See `ws:revoke` in
   * websocket.setup.
   */
  await redisClient.publish(
    'ws:revoke',
    JSON.stringify({ userId, ...record }),
  );
};

/**
 * Refuses every access token belonging to one session, leaving the rest alone.
 *
 * Call alongside deleting that session's refresh tokens, for the same reason
 * `revokeSessionsBefore` exists: dropping the refresh token stops the session
 * renewing, this stops the token already in that browser.
 */
export const markSessionRevoked = async (
  userId: string,
  sid: string,
): Promise<void> => {
  await redisClient.setEx(
    sessionRevocationKey(userId, sid),
    REVOCATION_TTL,
    '1',
  );

  /*
   * As above, a socket authorises once at its handshake and would otherwise
   * outlive the session it belongs to. This event names a session rather than
   * a moment, and the subscriber closes by `sid`.
   */
  await redisClient.publish('ws:revoke', JSON.stringify({ userId, sid }));
};

/** Whether this token predates the user's revocation epoch. */
const predatesRevocation = (
  raw: string | null,
  payload: { iat?: number; sid?: string },
): boolean => {
  if (!raw) return false;

  const record = JSON.parse(raw) as Revocation;
  if (record.keepSid && payload.sid === record.keepSid) return false;

  // A token with no `iat` cannot be placed in time. jsonwebtoken always sets
  // one, so this is a malformed token rather than an old one.
  if (!payload.iat) return false;

  return payload.iat < record.at;
};

/**
 * Whether this token has been revoked — as one of a user's sessions, or as the
 * particular session it belongs to.
 *
 * Fails **open** on a Redis error, deliberately and unlike the checks around
 * it. Every authenticated request runs this, so failing closed turns a Redis
 * blip into a total outage that presents as everyone being signed out at once.
 * The refresh tokens are already gone by then, so an unreachable Redis bounds
 * the exposure to one access-token lifetime — exactly the state this feature
 * improves on, rather than a regression from it.
 */
export const isSessionRevoked = async (payload: {
  userId: string;
  iat?: number;
  sid?: string;
}): Promise<boolean> => {
  try {
    if (!payload.sid) {
      const raw = await redisClient.get(revocationKey(payload.userId));
      return predatesRevocation(raw, payload);
    }

    const [epoch, ended] = await redisClient.mGet([
      revocationKey(payload.userId),
      sessionRevocationKey(payload.userId, payload.sid),
    ]);

    // Keyed by the session itself, so there is nothing to compare and nothing
    // to exempt: this session is over whenever the token in front of us was
    // minted, and `keepSid` belongs to the epoch, not here.
    if (ended !== null) return true;

    return predatesRevocation(epoch, payload);
  } catch (error) {
    logger.error('Revocation check failed, allowing the token:', error);
    return false;
  }
};
