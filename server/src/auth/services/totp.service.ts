import crypto from 'crypto';
import { redisClient } from '../../config/redis';

/*
 * RFC 6238 TOTP over RFC 4226 HOTP, on node's crypto. Implemented here rather
 * than pulled in as a dependency: it is about sixty lines, the algorithm is
 * fixed by the RFCs, and the alternative is trusting a transitive tree with the
 * second factor of every account.
 *
 * Base32 (RFC 4648, no padding) is the alphabet authenticator apps expect in an
 * otpauth:// URI; it is not interchangeable with base64.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const PERIOD_SECONDS = 30;

/**
 * How far out of step a client clock may be and still be accepted. One step
 * either side — the usual compromise between drift tolerance and the window an
 * intercepted code stays usable.
 */
const ALLOWED_DRIFT_STEPS = 1;

export const generateSecret = (bytes = 20): string =>
  base32Encode(crypto.randomBytes(bytes));

export const base32Encode = (buffer: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];

  return output;
};

export const base32Decode = (input: string): Buffer => {
  const cleaned = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character');

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
};

/** The HOTP code for one counter value. */
const hotp = (secret: Buffer, counter: number): string => {
  const buffer = Buffer.alloc(8);
  // Counter is 64-bit big-endian; the high word is always zero for any time
  // this code will run, but writing it keeps the layout correct.
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = crypto.createHmac('sha1', secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;

  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
};

export const generateCode = (secret: string, atMs = Date.now()): string =>
  hotp(base32Decode(secret), Math.floor(atMs / 1000 / PERIOD_SECONDS));

/**
 * The counter step a submitted code is valid for, or null. Returning the step
 * rather than a boolean is what makes single-use enforcement possible: the step
 * is the thing that has to be burned.
 *
 * The comparison is constant-time so a failure does not leak how much of the
 * code was right.
 */
export const matchCodeStep = (
  secret: string,
  code: string,
  atMs = Date.now(),
): number | null => {
  const submitted = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(submitted)) return null;

  const key = base32Decode(secret);
  const step = Math.floor(atMs / 1000 / PERIOD_SECONDS);

  for (
    let offset = -ALLOWED_DRIFT_STEPS;
    offset <= ALLOWED_DRIFT_STEPS;
    offset++
  ) {
    const expected = hotp(key, step + offset);
    const a = Buffer.from(expected);
    const b = Buffer.from(submitted);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return step + offset;
    }
  }

  return null;
};

/** Whether a submitted code is valid now, allowing for clock drift. */
export const verifyCode = (
  secret: string,
  code: string,
  atMs = Date.now(),
): boolean => matchCodeStep(secret, code, atMs) !== null;

/**
 * How long a burned step is remembered. A step is only ever accepted within
 * ALLOWED_DRIFT_STEPS of now, so remembering it for the width of that window
 * plus one period is enough — after that the code is rejected on its own merits.
 */
const BURN_TTL_SECONDS = PERIOD_SECONDS * (ALLOWED_DRIFT_STEPS * 2 + 2);

/**
 * Verifies a code and consumes it, so the same code cannot be presented twice.
 *
 * RFC 6238 §5.2 requires this: a code is valid for its whole period and, with
 * drift tolerance, for ninety seconds in total. Without a burn, anyone who
 * observes one — shoulder-surfing, a proxy, a screenshot in a support ticket —
 * can replay it for the rest of that window.
 *
 * The claim is a single SET NX, so two requests racing with the same code
 * cannot both win.
 */
export const verifyAndConsumeCode = async (
  userId: string,
  secret: string,
  code: string,
  atMs = Date.now(),
): Promise<boolean> => {
  const step = matchCodeStep(secret, code, atMs);
  if (step === null) return false;

  const claimed = await redisClient.set(
    `totp:used:${userId}:${step}`,
    '1',
    { NX: true, EX: BURN_TTL_SECONDS },
  );

  return claimed === 'OK';
};

/** The otpauth:// URI an authenticator app scans or accepts pasted. */
export const buildOtpAuthUri = (
  secret: string,
  account: string,
  issuer = 'chat-app',
): string => {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};
