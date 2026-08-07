import crypto from 'crypto';

/*
 * Recovery codes: the fallback for someone who has lost the factor itself.
 *
 * Everything here used to live inline in two-factor.controller, where the
 * generator inserted a dash and the verifier hashed whatever was typed. So a
 * code read off a printout and entered as `J3LT2L3N43` did not match the stored
 * hash of `J3LT2-L3N43` — and each attempt spent one of five tries against the
 * shared 2FA limiter, so the sixth answered 429 and locked the account for
 * fifteen minutes.
 *
 * That failure lands exactly where it does the most damage: a recovery code is
 * only ever reached for when the authenticator is already gone, so the user has
 * no other way in.
 */

export const RECOVERY_CODE_COUNT = 8;

/**
 * Human-transcribable: no lowercase, no 0/O/1/I. These get written down, so the
 * alphabet matters more than the extra bits a wider one would buy.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * The form a code is hashed in: letters and digits only, uppercased.
 *
 * The dash is presentation. Whether the user types it, omits it, uses a space
 * or an en-dash their phone autocorrected it to, they entered the same code —
 * so the separator must not survive into the hash.
 */
export const canonicalizeRecoveryCode = (code: string): string =>
  (code ?? '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

/** Stored hashed: a recovery code is password-equivalent. */
export const hashRecoveryCode = (code: string): string =>
  sha256(canonicalizeRecoveryCode(code));

/*
 * `randomInt` rather than `randomBytes(n)[i] % ALPHABET.length`.
 *
 * The modulo version happened to be unbiased: the alphabet is exactly 32
 * characters and 256 divides by 32, so all 32 landed on eight byte values
 * each. That is a property of the length, not of the code — dropping one
 * ambiguous character to make codes easier to read off a printout would leave
 * 31, and the first 8 characters would then come up 9/256 against 8/256 for
 * the rest. Nothing would fail, no test would catch it, and every code issued
 * afterwards would be measurably easier to guess.
 *
 * `randomInt` rejection-samples, so it is unbiased for any alphabet length and
 * the invariant no longer has to be remembered.
 */
export const generateRecoveryCode = (): string => {
  const chars = Array.from(
    { length: 10 },
    () => ALPHABET[crypto.randomInt(ALPHABET.length)],
  );
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}`;
};

export const generateRecoveryCodes = (count = RECOVERY_CODE_COUNT): string[] =>
  Array.from({ length: count }, generateRecoveryCode);

/**
 * The index of the stored hash a submission matches, or -1.
 *
 * Two hashes are tried. The canonical one is what everything issued from now on
 * is stored under. The second is the pre-existing `sha256(raw.toUpperCase())`,
 * which is how every code already in the database was hashed — those rows
 * cannot be rewritten (the plaintext is gone by design), so they are matched on
 * their own terms rather than migrated.
 *
 * The legacy form only ever matches when the user types the dash, which is the
 * behaviour those codes already had. Nothing gets stricter; the dash-less
 * spelling starts working for everything issued after this.
 */
export const findRecoveryCodeIndex = (
  storedHashes: readonly string[],
  submitted: string,
): number => {
  const canonical = canonicalizeRecoveryCode(submitted);
  if (!canonical) return -1;

  const candidates = [
    sha256(canonical),
    sha256((submitted ?? '').replace(/\s/g, '').toUpperCase()),
  ];

  for (const candidate of candidates) {
    const index = storedHashes.indexOf(candidate);
    if (index !== -1) return index;
  }

  return -1;
};
