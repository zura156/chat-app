import { redisClient } from '../../config/redis';
import crypto from 'crypto';

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

/** Ends one session by its id, leaving the user's other devices signed in. */
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
