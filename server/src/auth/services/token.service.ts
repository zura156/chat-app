import { redisClient } from '../../utils/redis';
import crypto from 'crypto';

const REFRESH_TTL = 7 * 24 * 60 * 60;
const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

const userSetKey = (userId: string) => `refresh:set:${userId}`;
const tokenKey = (userId: string, hash: string) => `refresh:${userId}:${hash}`;

export const storeRefreshToken = async (
  userId: string,
  token: string,
): Promise<void> => {
  const hash = hashToken(token);
  const tKey = tokenKey(userId, hash);
  const sKey = userSetKey(userId);
  await redisClient
    .multi()
    .setEx(tKey, REFRESH_TTL, '1')
    .sAdd(sKey, hash)
    .expire(sKey, REFRESH_TTL)
    .exec();
};

export const validateRefreshToken = async (
  userId: string,
  token: string,
): Promise<boolean> => {
  const result = await redisClient.get(tokenKey(userId, hashToken(token)));
  return result === '1';
};

// Atomic rotate via Lua: if old token exists → delete it + store new one
// If old token does NOT exist (reuse detected) → delete entire family
const ROTATE_SCRIPT = `
local old = KEYS[1]
local new = KEYS[2]
local set = KEYS[3]
local oldHash = ARGV[1]
local newHash = ARGV[2]
local ttl = tonumber(ARGV[3])

local exists = redis.call('GET', old)
if not exists then
  -- Reuse detected: wipe entire token family
  local members = redis.call('SMEMBERS', set)
  for _, h in ipairs(members) do
    redis.call('DEL', 'refresh:' .. ARGV[4] .. ':' .. h)
  end
  redis.call('DEL', set)
  return 0
end

redis.call('DEL', old)
redis.call('SREM', set, oldHash)
redis.call('SETEX', new, ttl, '1')
redis.call('SADD', set, newHash)
redis.call('EXPIRE', set, ttl)
return 1
`;

// Returns true = rotated OK, false = reuse detected (all sessions wiped)
export const rotateRefreshToken = async (
  userId: string,
  oldToken: string,
  newToken: string,
): Promise<boolean> => {
  const oldHash = hashToken(oldToken);
  const newHash = hashToken(newToken);
  const result = await redisClient.eval(ROTATE_SCRIPT, {
    keys: [
      tokenKey(userId, oldHash),
      tokenKey(userId, newHash),
      userSetKey(userId),
    ],
    arguments: [oldHash, newHash, String(REFRESH_TTL), userId],
  });
  return result === 1;
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
