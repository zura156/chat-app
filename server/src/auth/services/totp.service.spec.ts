import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateCode,
  generateSecret,
  matchCodeStep,
  verifyCode,
} from './totp.service';

/*
 * This is a hand-rolled implementation of RFC 4648, RFC 4226 and RFC 6238 —
 * deliberately, per the note in the service, but that trade only holds if the
 * output is pinned to the published vectors. A base32 or HOTP bug here does not
 * throw; it silently produces codes no authenticator app agrees with, and the
 * symptom is "2FA just rejects everything" long after the change that caused it.
 */

/** RFC 6238 Appendix B: the ASCII string "12345678901234567890" as the key. */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

const PERIOD = 30;
const at = (unixSeconds: number) => unixSeconds * 1000;

describe('base32', () => {
  // RFC 4648 §10, minus the '=' padding this implementation deliberately omits
  // (an otpauth:// secret is conventionally unpadded).
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('encodes %o as %o (RFC 4648)', (input, expected) => {
    expect(base32Encode(Buffer.from(input, 'ascii'))).toBe(expected);
  });

  it('decodes what it encodes, for arbitrary bytes', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = Buffer.from(
        Array.from({ length }, (_, i) => (i * 37 + 11) % 256),
      );
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });

  it('accepts padding and whitespace, which is how users paste a secret', () => {
    expect(base32Decode('MZXW 6YTB OI')).toEqual(Buffer.from('foobar'));
    expect(base32Decode('MY======')).toEqual(Buffer.from('f'));
    expect(base32Decode('mzxw6ytboi')).toEqual(Buffer.from('foobar'));
  });

  it('rejects characters outside the alphabet rather than decoding garbage', () => {
    // '0', '1' and '8' are absent from RFC 4648 base32 precisely because they
    // are confusable; silently mapping them would produce a wrong secret.
    expect(() => base32Decode('MZXW0')).toThrow();
    expect(() => base32Decode('MZXW8')).toThrow();
  });
});

describe('generateCode (RFC 6238 test vectors)', () => {
  /*
   * The published vectors are 8 digits; this implementation emits 6, which is
   * the same HOTP truncation taken modulo 10^6 — i.e. the last six digits.
   */
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('T=%i produces %s', (unixSeconds, expected) => {
    expect(generateCode(RFC_SECRET, at(unixSeconds))).toBe(expected);
  });

  it('is stable for the whole period and changes at the boundary', () => {
    const base = 1_700_000_000 - (1_700_000_000 % PERIOD);
    const code = generateCode(RFC_SECRET, at(base));

    expect(generateCode(RFC_SECRET, at(base + 29))).toBe(code);
    expect(generateCode(RFC_SECRET, at(base + PERIOD))).not.toBe(code);
  });
});

describe('matchCodeStep', () => {
  const now = at(1_700_000_000);
  const step = Math.floor(1_700_000_000 / PERIOD);

  it('returns the step a valid code belongs to, not merely true', () => {
    // The step is what `verifyAndConsumeCode` burns; a boolean could not
    // express single use.
    expect(matchCodeStep(RFC_SECRET, generateCode(RFC_SECRET, now), now)).toBe(
      step,
    );
  });

  it('accepts one step of drift either side, and no more', () => {
    const previous = generateCode(RFC_SECRET, now - PERIOD * 1000);
    const next = generateCode(RFC_SECRET, now + PERIOD * 1000);
    const tooOld = generateCode(RFC_SECRET, now - 2 * PERIOD * 1000);
    const tooNew = generateCode(RFC_SECRET, now + 2 * PERIOD * 1000);

    expect(matchCodeStep(RFC_SECRET, previous, now)).toBe(step - 1);
    expect(matchCodeStep(RFC_SECRET, next, now)).toBe(step + 1);
    expect(matchCodeStep(RFC_SECRET, tooOld, now)).toBeNull();
    expect(matchCodeStep(RFC_SECRET, tooNew, now)).toBeNull();
  });

  it('rejects anything that is not exactly six digits', () => {
    // The constant-time compare below requires equal lengths to run at all, so
    // this shape check is load-bearing rather than cosmetic.
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56', '  ']) {
      expect(matchCodeStep(RFC_SECRET, bad, now)).toBeNull();
    }
  });

  it('tolerates the spaces authenticator apps display between digit groups', () => {
    const code = generateCode(RFC_SECRET, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(matchCodeStep(RFC_SECRET, spaced, now)).toBe(step);
  });

  it('rejects a code from a different secret', () => {
    const other = base32Encode(Buffer.from('09876543210987654321', 'ascii'));
    expect(verifyCode(RFC_SECRET, generateCode(other, now), now)).toBe(false);
  });
});

describe('generateSecret', () => {
  it('produces a decodable secret of the requested strength', () => {
    const secret = generateSecret();
    expect(base32Decode(secret)).toHaveLength(20); // 160 bits, per RFC 4226 §4
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it('does not repeat', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateSecret()));
    expect(secrets.size).toBe(50);
  });
});
