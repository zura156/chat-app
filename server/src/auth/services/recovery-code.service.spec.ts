import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import {
  RECOVERY_CODE_COUNT,
  canonicalizeRecoveryCode,
  findRecoveryCodeIndex,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
} from './recovery-code.service';

/*
 * The regression these cover: a code was generated as `XXXXX-XXXXX` and hashed
 * exactly as typed, so entering it without the dash — which is how it reads off
 * a printout, and what most people type — did not match. Each miss also spent
 * one of five tries on the shared 2FA limiter, so the sixth answered 429 and
 * locked the account for fifteen minutes.
 *
 * That lands at the worst possible moment: a recovery code is only ever reached
 * for when the authenticator is already gone.
 */

describe('recovery codes', () => {
  describe('generation', () => {
    it('produces a dashed, transcribable code', () => {
      expect(generateRecoveryCode()).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    });

    it('omits the characters that are read wrong by hand', () => {
      const codes = generateRecoveryCodes(200).join('');
      for (const ambiguous of ['0', 'O', '1', 'I']) {
        expect(codes).not.toContain(ambiguous);
      }
    });

    it('issues a full set by default', () => {
      expect(generateRecoveryCodes()).toHaveLength(RECOVERY_CODE_COUNT);
    });

    it('does not repeat itself', () => {
      const codes = generateRecoveryCodes(50);
      expect(new Set(codes).size).toBe(50);
    });
  });

  describe('canonicalization', () => {
    it('reduces every reasonable spelling to one form', () => {
      const forms = [
        'J3LT2-L3N43',
        'J3LT2L3N43',
        'j3lt2-l3n43',
        'J3LT2 - L3N43',
        ' J3LT2-L3N43 ',
        'J3LT2—L3N43', // em-dash, which phone keyboards like to substitute
      ];

      for (const form of forms) {
        expect(canonicalizeRecoveryCode(form)).toBe('J3LT2L3N43');
      }
    });
  });

  describe('lookup', () => {
    const stored = ['J3LT2-L3N43', 'U2A3V-YBLX4'].map(hashRecoveryCode);

    it('finds a code typed exactly as it was shown', () => {
      expect(findRecoveryCodeIndex(stored, 'J3LT2-L3N43')).toBe(0);
    });

    it('finds a code typed without the dash', () => {
      // The bug. This returned -1.
      expect(findRecoveryCodeIndex(stored, 'J3LT2L3N43')).toBe(0);
    });

    it('finds a code typed in lower case, with stray spaces', () => {
      expect(findRecoveryCodeIndex(stored, ' j3lt2 l3n43 ')).toBe(0);
    });

    it('reports the right index for a later code', () => {
      expect(findRecoveryCodeIndex(stored, 'U2A3VYBLX4')).toBe(1);
    });

    it('refuses a code that was never issued', () => {
      expect(findRecoveryCodeIndex(stored, 'AAAAA-BBBBB')).toBe(-1);
    });

    it('refuses an empty submission rather than matching anything', () => {
      expect(findRecoveryCodeIndex(stored, '')).toBe(-1);
      expect(findRecoveryCodeIndex(stored, '   ')).toBe(-1);
      expect(findRecoveryCodeIndex(stored, '---')).toBe(-1);
    });

    it('refuses everything against an empty set', () => {
      expect(findRecoveryCodeIndex([], 'J3LT2-L3N43')).toBe(-1);
    });

    /*
     * Codes issued before this change were stored as sha256 of the raw string
     * with its dash. The plaintext is gone by design, so those rows cannot be
     * rewritten — they have to keep working on their own terms.
     */
    it('still accepts codes hashed the old way', () => {
      const legacy = crypto
        .createHash('sha256')
        .update('J3LT2-L3N43')
        .digest('hex');

      expect(findRecoveryCodeIndex([legacy], 'J3LT2-L3N43')).toBe(0);
      expect(findRecoveryCodeIndex([legacy], 'j3lt2-l3n43')).toBe(0);
    });
  });

  describe('storage', () => {
    it('never stores the plaintext', () => {
      const code = generateRecoveryCode();
      const hashed = hashRecoveryCode(code);

      expect(hashed).not.toContain(code);
      expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    });

    it('hashes every spelling of one code to the same value', () => {
      expect(hashRecoveryCode('J3LT2-L3N43')).toBe(
        hashRecoveryCode('j3lt2l3n43'),
      );
    });
  });
});
