import { Request, Response, NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../../config/redis';
import {
  verifyAccessToken,
  verifyRefreshToken,
  verifyTwoFactorChallenge,
} from '../services/jwt.service';
import { normalizeEmail } from '../services/auth.service';
import type { AuthRequest } from './auth.middleware';

/** What a limiter hangs off the request so `resetRateLimit` can find it again. */
interface RateLimitedRequest extends Request {
  /** Signature-checked caller id, for keying only — never for authorisation. */
  rateLimitUserId?: string;
  rateLimitKeys?: {
    attemptsKey: string;
    cooldownKey: string;
    roundKey: string;
  };
}

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * Best-effort identity, for rate limiting only.
 *
 * The general limiter is mounted globally, which is *before* `authenticateToken`
 * runs on any router — so `req.user` was always undefined there and the
 * signed-in half of its budget was dead code. Every authenticated user was held
 * to the anonymous allowance, keyed by IP and therefore shared with everyone
 * behind the same NAT: one busy tab could 429 an entire office.
 *
 * Expiry is deliberately ignored. The request that most needs a per-user bucket
 * is `/auth/refresh`, which by definition arrives with an access token that has
 * just expired — and a 429 there is what logged people out. The signature is
 * still verified, so the id cannot be forged; the worst an old token buys is a
 * bucket its own account already had.
 */
export const identifyForRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { accessToken, refreshToken } = req.cookies ?? {};

  if (accessToken) {
    try {
      (req as RateLimitedRequest).rateLimitUserId = verifyAccessToken(
        accessToken,
        { ignoreExpiration: true },
      ).userId;
      next();
      return;
    } catch {
      // Not ours, or not an access token — fall through to the refresh cookie.
    }
  }

  // Scoped by cookie path to /auth/refresh, so this only ever fires there.
  if (refreshToken) {
    try {
      (req as RateLimitedRequest).rateLimitUserId =
        verifyRefreshToken(refreshToken).userId;
    } catch {
      // Anonymous. Falls back to the IP bucket below.
    }
  }

  next();
};

const identityKey = (req: Request): string => {
  const userId = (req as RateLimitedRequest).rateLimitUserId;
  // ipKeyGenerator collapses an IPv6 address to its /56 — without it a single
  // client with a routed prefix has effectively unlimited keys.
  return userId ? `u:${userId}` : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
};

// ─── The global backstop ─────────────────────────────────────────────────────

let _generalLimiter: ReturnType<typeof rateLimit> | null = null;
let _presignLimiter: ReturnType<typeof rateLimit> | null = null;

/**
 * Called once Redis is connected. Until then both limiters fail open, which is
 * the right trade for a backstop: the per-identity limiters below are what
 * actually protect credentials.
 */
export function initLimiters(): void {
  const store = (prefix: string) =>
    new RedisStore({
      prefix,
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    });

  _generalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    // A chat client is chatty: history paging, conversation lists, presence and
    // profile lookups all ride HTTP. This is an abuse ceiling, not a throttle —
    // anything that needs a tight bound has its own limiter.
    limit: (req) => ((req as RateLimitedRequest).rateLimitUserId ? 1000 : 300),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: identityKey,
    // Same shape as the per-identity limiters below, so the client has one
    // thing to read rather than a bare string from this one and JSON elsewhere.
    message: {
      message: 'Too many requests. Please slow down and try again shortly.',
      code: 'RATE_LIMITED',
    },
    store: store('rl_general:'),
  });

  _presignLimiter = rateLimit({
    windowMs: 60_000,
    limit: (req) => ((req as RateLimitedRequest).rateLimitUserId ? 120 : 30),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: 'Too many upload requests. Please slow down.',
      code: 'RATE_LIMITED',
    },
    keyGenerator: identityKey,
    store: store('rl_presign:'),
  });
}

export const generalLimiter = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!_generalLimiter) return next();
  _generalLimiter(req, res, next);
};

export const presignLimiter = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!_presignLimiter) return next();
  _presignLimiter(req, res, next);
};

// ─── Per-identity limiters ───────────────────────────────────────────────────

interface RateLimitConfig {
  keyPrefix: string;
  /** Attempts granted per round. */
  allowance: number;
  /**
   * How long an unspent, un-tripped tally lives. This is the forgiveness
   * window: attempt sporadically and you never reach a cooldown at all.
   */
  windowMs: number;
  /**
   * One cooldown per round of escalation; the last entry repeats forever. So
   * `[5m, 15m, 1h]` with an allowance of 5 means five tries then five minutes,
   * five more then fifteen, and five at a time an hour apart after that.
   */
  cooldownsMs: number[];
  keyGenerator: (req: Request) => string;
}

const formatWait = (seconds: number): string => {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
};

const respondLimited = (res: Response, retryAfter: number): void => {
  // Standard header, so browsers and any intermediary can see the same number
  // the JSON body carries.
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({
    message: `Too many attempts. Try again in ${formatWait(retryAfter)}.`,
    code: 'RATE_LIMITED',
    retryAfter,
  });
};

/**
 * Counts on the way in, and is cleared by `resetRateLimit` when the request
 * turns out to be legitimate.
 *
 * This replaces a two-part design — a `createRateLimiter` that only read the
 * cooldown and a separate `incrementRateLimit` the handler had to remember to
 * call on failure. Five of the seven protected routes never called it, so
 * `/register`, `/reset-password`, `/resend-verification`, `/2fa/confirm` and
 * `DELETE /2fa` were checking a counter nothing ever wrote: the middleware was
 * mounted, looked correct in review, and enforced nothing. Six-digit codes and
 * password-reset tokens took unlimited guesses.
 *
 * Counting on entry cannot be forgotten, and the failure mode of forgetting the
 * reset is a limiter that is slightly strict rather than one that is absent.
 *
 * Serving a cooldown restores the allowance. The old shape — one tally compared
 * against cumulative thresholds — meant the counter still sat above the
 * threshold when the cooldown lapsed, so the very next request re-armed it
 * immediately and the caller was locked out for as long as they kept trying.
 * That is the behaviour behind "some of them are really strict": a five-minute
 * cooldown that in practice never ended.
 */
export function createRateLimiter(config: RateLimitConfig) {
  const windowSeconds = Math.ceil(config.windowMs / 1000);
  const longestCooldownMs = Math.max(...config.cooldownsMs);

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const key = config.keyGenerator(req);
    const attemptsKey = `${config.keyPrefix}:attempts:${key}`;
    const cooldownKey = `${config.keyPrefix}:cooldown:${key}`;
    const roundKey = `${config.keyPrefix}:round:${key}`;
    (req as RateLimitedRequest).rateLimitKeys = {
      attemptsKey,
      cooldownKey,
      roundKey,
    };

    try {
      const cooldownTTL = await redisClient.ttl(cooldownKey);
      if (cooldownTTL > 0) {
        respondLimited(res, cooldownTTL);
        return;
      }

      const attempts = await redisClient.incr(attemptsKey);

      // Only on the first attempt of a round. Re-arming the TTL on every
      // increment made the window slide, so a steady trickle kept a tally alive
      // indefinitely and the shortest window silently became the longest one.
      if (attempts === 1) {
        await redisClient.expire(attemptsKey, windowSeconds);
      }

      // Strictly greater: the allowance is spent by the attempt that reaches it,
      // not refused. Otherwise the last permitted try — the one where the user
      // finally types the right password — never reaches the handler.
      if (attempts > config.allowance) {
        const round = await redisClient.incr(roundKey);
        const cooldownMs =
          config.cooldownsMs[
            Math.min(round - 1, config.cooldownsMs.length - 1)
          ];
        const retryAfter = Math.ceil(cooldownMs / 1000);

        await redisClient.setEx(cooldownKey, retryAfter, '1');
        // The tally is what the cooldown was charged for. Clearing it is what
        // makes waiting mean something; the round counter is what remembers, so
        // the next cooldown is the longer one.
        await redisClient.del(attemptsKey);
        // Outlives the cooldown it escalated, so repeat offenders keep climbing,
        // but forgets eventually.
        await redisClient.expire(
          roundKey,
          Math.ceil((config.windowMs + longestCooldownMs * 2) / 1000),
        );

        respondLimited(res, retryAfter);
        return;
      }

      next();
    } catch {
      // Redis being down must not take sign-in down with it.
      next();
    }
  };
}

/**
 * Clears the caller's counter after they prove they are legitimate — a correct
 * password, a valid reset token, a good second factor. Without it a user who
 * mistypes twice carries those attempts for the rest of the window.
 */
export const resetRateLimit = async (req: Request): Promise<void> => {
  const keys = (req as RateLimitedRequest).rateLimitKeys;
  if (!keys) return;
  try {
    // The round counter goes too: proving you are the account holder should not
    // leave you one mistake away from an hour-long cooldown.
    await redisClient.del([keys.attemptsKey, keys.cooldownKey, keys.roundKey]);
  } catch {
    // Non-critical: the counter expires on its own.
  }
};

// ─── Configurations ──────────────────────────────────────────────────────────

const ipKey = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;

const userKey = (req: Request): string => {
  const userId = (req as AuthRequest).user?._id;
  return userId ? `u:${userId.toString()}` : ipKey(req);
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Keyed by address *and* origin so one attacker cannot lock a user out of their
 * own account from elsewhere. The address is normalised through the same helper
 * every lookup uses: keying on the raw body let `Foo@x.com` and `foo@x.com`
 * hold separate counters against the one account.
 */
const loginLimiter = createRateLimiter({
  keyPrefix: 'login',
  allowance: 5,
  windowMs: 15 * MINUTE,
  cooldownsMs: [5 * MINUTE, 15 * MINUTE, HOUR],
  keyGenerator: (req) =>
    `${normalizeEmail(req.body?.email ?? '')}|${req.ip ?? 'unknown'}`,
});

/**
 * An unauthenticated endpoint that creates a record and sends mail to an
 * address the caller chooses, so it is both an account-spam and an
 * email-bombing primitive. Successful registrations are the abuse here, so this
 * one is never reset. Mounted after validation, so a fumbled password rule does
 * not burn an attempt.
 */
const registerLimiter = createRateLimiter({
  keyPrefix: 'register',
  allowance: 5,
  windowMs: HOUR,
  cooldownsMs: [30 * MINUTE, 3 * HOUR],
  keyGenerator: ipKey,
});

/**
 * Keyed by the address the mail would go to, because the thing being rationed
 * is someone else's inbox — an IP key lets one caller bomb many addresses, and
 * counting only unknown addresses (as this did) exempted the abuse entirely.
 */
const forgotPasswordLimiter = createRateLimiter({
  keyPrefix: 'forgot',
  allowance: 3,
  windowMs: HOUR,
  cooldownsMs: [15 * MINUTE, HOUR],
  keyGenerator: (req) => normalizeEmail(req.body?.email ?? '') || ipKey(req),
});

/**
 * Guessing a reset token, which is a different activity from requesting one —
 * these shared the `forgot` prefix and both fell back to an IP key, so
 * /reset-password and /resend-verification silently drained each other's budget.
 */
const resetPasswordLimiter = createRateLimiter({
  keyPrefix: 'reset',
  allowance: 10,
  windowMs: 15 * MINUTE,
  cooldownsMs: [15 * MINUTE, HOUR],
  // `userId` on /reset-password, `id` on /confirm-email — the two routes share
  // this limiter but not their field names, so reading only `userId` collapsed
  // every confirm-email caller behind one address into a single "anon" bucket.
  keyGenerator: (req) =>
    `${req.body?.userId ?? req.body?.id ?? 'anon'}|${req.ip ?? 'unknown'}`,
});

/**
 * Redeeming a link that arrived by email: verifying an address, unlocking an
 * account. Both were the only unauthenticated token-taking routes with nothing
 * but the global backstop in front of them.
 *
 * The tokens are random UUIDs, so this is not really about guessing them — it
 * is about the database lookup and the writes behind it being free and
 * unlimited to anyone who can name a user id.
 *
 * Its own prefix rather than sharing `reset`: the comment there is the reason —
 * routes that share a key prefix drain each other's budget, and a user who has
 * just been locked out is quite likely to be using both.
 */
const accountTokenLimiter = createRateLimiter({
  keyPrefix: 'account-token',
  allowance: 10,
  windowMs: 15 * MINUTE,
  cooldownsMs: [15 * MINUTE, HOUR],
  keyGenerator: (req) =>
    `${req.body?.userId ?? req.body?.id ?? 'anon'}|${req.ip ?? 'unknown'}`,
});

/** Sends mail on every call, so it is rationed per account, not per address. */
const resendVerificationLimiter = createRateLimiter({
  keyPrefix: 'resend',
  allowance: 3,
  windowMs: HOUR,
  cooldownsMs: [30 * MINUTE],
  keyGenerator: userKey,
});

/**
 * Verifies the current password, so it is a password oracle for anyone who has
 * got hold of a live session — a borrowed unlocked laptop, a stolen cookie —
 * and the reward for guessing right is taking the account over. Keyed per
 * account rather than per IP: the thing being protected is one user's password,
 * and an attacker in that position controls the origin anyway.
 */
const changePasswordLimiter = createRateLimiter({
  keyPrefix: 'changepw',
  allowance: 5,
  windowMs: 15 * MINUTE,
  cooldownsMs: [15 * MINUTE, HOUR],
  keyGenerator: userKey,
});

/**
 * Every route that verifies a six-digit code: the second step of a sign-in,
 * confirming enrolment, and turning the factor off. One in a million per guess
 * only means something if the guesses are bounded.
 *
 * The sign-in step has no session yet, so it is keyed off the challenge cookie —
 * that ties the budget to the account under attack rather than to an IP the
 * attacker can rotate. Keying it on `req.body.email` (as the login limiter does)
 * produced the literal key "undefined:<ip>" for every caller.
 */
const twoFactorCodeLimiter = createRateLimiter({
  keyPrefix: '2fa',
  allowance: 5,
  windowMs: 15 * MINUTE,
  cooldownsMs: [15 * MINUTE, HOUR],
  keyGenerator: (req) => {
    const userId = (req as AuthRequest).user?._id;
    if (userId) return `u:${userId.toString()}`;

    const challenge = req.cookies?.twoFactorChallenge as string | undefined;
    if (challenge) {
      try {
        return `u:${verifyTwoFactorChallenge(challenge).userId}`;
      } catch {
        // Expired or forged — fall through to the address.
      }
    }
    return ipKey(req);
  },
});

/**
 * Enrolment already costs a live session and the account password, so this is
 * looser than the code routes — it exists to stop a compromised session from
 * churning secrets, not to police a user re-scanning a QR code.
 */
const twoFactorSetupLimiter = createRateLimiter({
  keyPrefix: '2fa-setup',
  allowance: 10,
  windowMs: HOUR,
  cooldownsMs: [15 * MINUTE],
  keyGenerator: userKey,
});

export {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  accountTokenLimiter,
  resendVerificationLimiter,
  changePasswordLimiter,
  twoFactorCodeLimiter,
  twoFactorSetupLimiter,
};
