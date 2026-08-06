import crypto from 'crypto';
import { redisClient } from '../../config/redis';

/*
 * One-time codes delivered by email, as a second factor alongside TOTP.
 *
 * Redis rather than Mongo, deliberately. A login code is a short-lived secret
 * with a hard expiry, a send throttle and an attempt cap — all three are TTL
 * problems, and all three are what Redis does natively. Storing them in the
 * 2FA document would mean a schema field per counter, a sweeper for the expired
 * ones, and a read-modify-write race on every guess.
 *
 * The code is stored hashed. It is emailed in plaintext, so the mail itself is
 * the weak link; that is inherent to the factor. What is not inherent is a
 * database dump handing over every in-flight code, which hashing prevents.
 */

/** What a code authorises. Kept separate so one cannot be replayed as another. */
export type EmailOtpPurpose = 'login' | 'enroll';

const DIGITS = 6;

/** How long a delivered code stays usable. */
const CODE_TTL_SECONDS = 10 * 60;

/**
 * Minimum gap between sends for the same purpose.
 *
 * The endpoint sends mail to an address the caller does not choose, so this is
 * not an email-bombing primitive in the way /forgot-password is — but a stuck
 * client retrying in a loop still fills the user's inbox and burns SMTP quota.
 */
const RESEND_INTERVAL_SECONDS = 60;

/**
 * Guesses allowed against one delivered code before it is discarded.
 *
 * A six-digit code is one in a million per guess, which only means something if
 * the guesses are bounded. The route limiter bounds them per account too; this
 * bounds them per *code*, so a fresh send cannot be used to reset the tally on
 * an old one that is still being worked on.
 */
const MAX_ATTEMPTS = 5;

const codeKey = (userId: string, purpose: EmailOtpPurpose) =>
  `2fa:email:code:${purpose}:${userId}`;
const throttleKey = (userId: string, purpose: EmailOtpPurpose) =>
  `2fa:email:sent:${purpose}:${userId}`;
const attemptsKey = (userId: string, purpose: EmailOtpPurpose) =>
  `2fa:email:tries:${purpose}:${userId}`;

const hash = (code: string) =>
  crypto.createHash('sha256').update(code).digest('hex');

/**
 * A uniformly distributed n-digit code.
 *
 * `randomInt` rather than `randomBytes % 10` — the modulo of a byte over ten
 * favours the low digits, which is a real bias on a secret this short.
 */
const generateCode = (): string =>
  Array.from({ length: DIGITS }, () => crypto.randomInt(0, 10)).join('');

export interface IssuedEmailCode {
  code: string;
  expiresAt: Date;
}

/**
 * Mints a code and stores its hash, unless one was sent moments ago.
 *
 * Returns null when the throttle is in force. The caller answers the same way
 * either way: telling the user "a code is on its way" whether or not this one
 * actually sent avoids turning the endpoint into a probe for whether a factor
 * is enrolled, and matches what the user sees anyway — a code in their inbox.
 */
export const issueEmailCode = async (
  userId: string,
  purpose: EmailOtpPurpose,
): Promise<IssuedEmailCode | null> => {
  const throttled = await redisClient.set(
    throttleKey(userId, purpose),
    '1',
    { NX: true, EX: RESEND_INTERVAL_SECONDS },
  );
  if (throttled !== 'OK') return null;

  const code = generateCode();

  // A new code replaces the previous one outright, and the attempt tally goes
  // with it: the old code is gone, so tries spent against it are not tries
  // against this one.
  await redisClient.set(codeKey(userId, purpose), hash(code), {
    EX: CODE_TTL_SECONDS,
  });
  await redisClient.del(attemptsKey(userId, purpose));

  return {
    code,
    expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
  };
};

/**
 * Verifies a code and consumes it, so it cannot be presented twice.
 *
 * The stored value is deleted on success before anything else happens: two
 * requests racing with the same code must not both be able to act on it.
 */
export const verifyAndConsumeEmailCode = async (
  userId: string,
  purpose: EmailOtpPurpose,
  submitted: string,
): Promise<boolean> => {
  const cleaned = (submitted ?? '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(cleaned)) return false;

  const key = codeKey(userId, purpose);
  const stored = await redisClient.get(key);
  if (!stored) return false;

  const attempts = await redisClient.incr(attemptsKey(userId, purpose));
  if (attempts === 1) {
    await redisClient.expire(attemptsKey(userId, purpose), CODE_TTL_SECONDS);
  }
  if (attempts > MAX_ATTEMPTS) {
    // Worked over too hard to still be trusted, whoever is doing the working.
    await redisClient.del([key, attemptsKey(userId, purpose)]);
    return false;
  }

  const a = Buffer.from(stored);
  const b = Buffer.from(hash(cleaned));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  // DEL reports how many keys it removed, so the request that gets 1 is the
  // one that consumed the code. A loser in a race sees 0 and is refused, which
  // is what single-use has to mean under concurrency.
  const consumed = await redisClient.del(key);
  if (consumed !== 1) return false;

  await redisClient.del(attemptsKey(userId, purpose));
  return true;
};

/**
 * Drops any in-flight code, used when a factor is torn down.
 *
 * Best-effort on purpose. Every caller is finishing something that has already
 * succeeded — a factor removed, an account deleted — and every key here carries
 * its own TTL, so an unreachable Redis costs at most ten minutes of a code that
 * nothing will accept anyway. Letting it throw would fail the deletion itself,
 * which is both worse and unrecoverable from the caller's side.
 */
export const clearEmailCode = async (
  userId: string,
  purpose: EmailOtpPurpose,
): Promise<void> => {
  try {
    await redisClient.del([
      codeKey(userId, purpose),
      attemptsKey(userId, purpose),
      throttleKey(userId, purpose),
    ]);
  } catch {
    // Non-critical: the keys expire on their own.
  }
};

export const EMAIL_OTP_TTL_SECONDS = CODE_TTL_SECONDS;
export const EMAIL_OTP_RESEND_SECONDS = RESEND_INTERVAL_SECONDS;
