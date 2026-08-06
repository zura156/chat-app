import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPassword,
  isPasswordAcceptable,
  normalizeForBlocklist,
  passwordLength,
} from './password-policy';

/*
 * ── The shared vector table ─────────────────────────────────────────────────
 *
 * This exact table is also run by the Angular validator's spec, at
 * src/app/features/auth/validators/password.validator.spec.ts. The two
 * implementations are separate because the packages build separately; the table
 * is what stops them drifting apart again.
 *
 * They diverged before, and it was not visible from either side: the form
 * accepted `PASSW0RD!` and the API refused it, the form and the model accepted
 * `Passw0rd#` and the router refused it, and the login form's copy of the rules
 * blocked sign-in for accounts whose password predated them.
 *
 * If you change a rule, change both files and both tables.
 */
export const SHARED_VECTORS: { password: string; acceptable: boolean; why: string }[] =
  [
    // ── Accepted ──────────────────────────────────────────────────────────
    {
      password: 'correct-horse-tangerine-lamp',
      acceptable: true,
      why: 'a passphrase — long, unpredictable, and refused by all three of the old rules',
    },
    {
      password: 'anvil poppy quartz drift',
      acceptable: true,
      why: 'spaces are allowed; NIST asks for them explicitly',
    },
    {
      password: 'Th1s-Is-A-Long-Enough-One!',
      acceptable: true,
      why: 'still fine to use mixed types — they are simply not required',
    },
    {
      password: 'vessel wer quartz drift',
      acceptable: true,
      why: 'contains a keyboard run (wer) but is not made of one — coverage, not presence',
    },
    {
      password: '#starts-with-a-symbol-x',
      acceptable: true,
      why: 'the old router regex refused any password whose first character was not alphanumeric',
    },
    {
      password: 'PASSPHRASE WITHOUT LOWERCASE',
      acceptable: true,
      why: 'no composition rule, so an all-caps passphrase is fine',
    },

    // ── Refused ───────────────────────────────────────────────────────────
    {
      password: 'P@ssw0rd!',
      acceptable: false,
      why: 'satisfied every one of the three old policies and is in every cracking dictionary — too short now',
    },
    {
      password: 'Tr0ub4dor&3',
      acceptable: false,
      why: 'the canonical "complex but short" password',
    },
    {
      password: 'short',
      acceptable: false,
      why: 'far below the minimum',
    },
    {
      password: 'aaaaaaaaaaaaaaaaaaaa',
      acceptable: false,
      why: 'long but one distinct character',
    },
    {
      password: 'abababababababababab',
      acceptable: false,
      why: 'a repeated unit',
    },
    {
      password: 'passwordpassword',
      acceptable: false,
      why: 'a repeated common word',
    },
    {
      password: 'P@ssw0rdP@ssw0rd',
      acceptable: false,
      why: 'the same, wearing leetspeak — normalisation sees through it',
    },
    {
      password: 'qwertyuiopasdfgh',
      acceptable: false,
      why: 'a keyboard walk',
    },
    {
      password: '123456789012345678',
      acceptable: false,
      why: 'a digit run',
    },
    {
      password: 'abcdefghijklmnopqr',
      acceptable: false,
      why: 'an alphabet run',
    },
    {
      password: 'zzzzzzzzzzzzzzzabcdefgh',
      acceptable: false,
      why: 'a long repeat plus an alphabet run is still entirely pattern, however many characters it has',
    },
    {
      password: 'poiuytrewqlkjhgfd',
      acceptable: false,
      why: 'keyboard rows walked backwards',
    },
    {
      password: 'correcthorsebatterystaple',
      acceptable: false,
      why: 'the xkcd example, and therefore in every wordlist',
    },
  ];

describe('password policy', () => {
  it('is at least the NIST single-factor floor', () => {
    // SP 800-63B rev. 4 §3.1.1: 15 characters when the password is the only
    // factor. Two-factor is opt-in here, so this is the applicable number.
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(15);
    // "SHOULD permit a maximum password length of at least 64 characters."
    expect(PASSWORD_MAX_LENGTH).toBeGreaterThanOrEqual(64);
  });

  describe('shared vectors', () => {
    it.each(SHARED_VECTORS)(
      '$acceptable ← $password ($why)',
      ({ password, acceptable }) => {
        expect(isPasswordAcceptable(password)).toBe(acceptable);
      },
    );
  });

  describe('no composition rules', () => {
    /*
     * "Verifiers and CSPs SHALL NOT impose other composition rules (e.g.,
     * requiring mixtures of different character types) for passwords."
     *
     * Each of these is long enough and unpredictable enough, and is missing one
     * character class. All must be accepted.
     */
    it.each([
      ['no uppercase', 'thunder plum vessel kite'],
      ['no lowercase', 'THUNDER PLUM VESSEL KITE'],
      ['no digits', 'thunder-plum-vessel-kite'],
      ['no symbols', 'thunder plum vessel kite 47'],
      ['letters only', 'thunder plum vessel kite orbit'],
      ['digits and letters only', 'thunder7plum4vessel9kite'],
    ])('accepts a password with %s', (_label, password) => {
      expect(isPasswordAcceptable(password)).toBe(true);
    });
  });

  describe('length', () => {
    it('refuses one character below the minimum and accepts the minimum', () => {
      const short = 'q7w'.repeat(20).slice(0, PASSWORD_MIN_LENGTH - 1);
      const exact = 'q7w'.repeat(20).slice(0, PASSWORD_MIN_LENGTH);

      expect(checkPassword(short).map((p) => p.code)).toContain('too_short');
      expect(checkPassword(exact).map((p) => p.code)).not.toContain('too_short');
    });

    it('refuses one character above the maximum', () => {
      const long = 'q7wEr!'.repeat(40).slice(0, PASSWORD_MAX_LENGTH + 1);
      expect(checkPassword(long).map((p) => p.code)).toContain('too_long');
    });

    it('counts characters, not UTF-16 code units', () => {
      // Fourteen emoji are 28 code units. Counting those would let a
      // 14-character password satisfy a 15-character rule.
      const emoji = '🙂'.repeat(14);
      expect(emoji.length).toBe(28);
      expect(passwordLength(emoji)).toBe(14);
      expect(checkPassword(emoji).map((p) => p.code)).toContain('too_short');
    });

    it('does not trim, because trimming would change the password', () => {
      // NIST: verify the entire submitted password, not a subset of it.
      const padded = '   anvil poppy quartz   ';
      expect(passwordLength(padded)).toBe(padded.length);
      expect(isPasswordAcceptable(padded)).toBe(true);
    });
  });

  describe('reports every problem at once', () => {
    it('does not stop at the first', () => {
      // The form renders these as a list; one at a time turns setting a
      // password into a guessing game.
      const codes = checkPassword('aaaaaaaaaaaaaaaaaaaa').map((p) => p.code);
      expect(codes).toContain('too_simple');
    });

    it('stays quiet about predictability while the password is still too short', () => {
      // "aaa" is both, and saying so twice is noise on top of "too short".
      const codes = checkPassword('aaa').map((p) => p.code);
      expect(codes).toEqual(['too_short']);
    });

    it('carries a message for every problem', () => {
      for (const problem of checkPassword('abc')) {
        expect(problem.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('normalisation', () => {
    it('folds case, leetspeak and punctuation to one form', () => {
      expect(normalizeForBlocklist('P@ssw0rd')).toBe('password');
      expect(normalizeForBlocklist('p-a-s-s-w-o-r-d')).toBe('password');
      expect(normalizeForBlocklist('!L0v3!')).toBe('ilovei');
    });

    it('is what makes the blocklist resistant to dressing a word up', () => {
      for (const variant of [
        'passwordpassword',
        'PasswordPassword',
        'P@ssw0rd-P@ssw0rd',
        'p.a.s.s.w.o.r.d.p.a.s.s.w.o.r.d',
      ]) {
        expect(isPasswordAcceptable(variant)).toBe(false);
      }
    });
  });

  describe('identity terms', () => {
    const context = { username: 'zurab', email: 'zurab.g@example.com' };

    it('refuses a password built from the username', () => {
      expect(
        checkPassword('zurab-loves-tangerines', context).map((p) => p.code),
      ).toContain('contains_identity');
    });

    it('refuses a password built from the email local part', () => {
      expect(
        checkPassword('my zurabg address here', {
          username: 'someone',
          email: 'zurabg@example.com',
        }).map((p) => p.code),
      ).toContain('contains_identity');
    });

    it('refuses a password built from the app name', () => {
      expect(
        checkPassword('chatapp is my favourite').map((p) => p.code),
      ).toContain('contains_identity');
    });

    it('accepts the same password for a different account', () => {
      expect(
        isPasswordAcceptable('zurab-loves-tangerines', {
          username: 'someone-else',
          email: 'other@example.com',
        }),
      ).toBe(true);
    });

    it('ignores a username too short to be meaningful', () => {
      // A three-letter username would otherwise reject a large share of all
      // passwords for containing those letters together.
      expect(
        isPasswordAcceptable('abc tangerine vessel kite', {
          username: 'abc',
          email: 'ab@example.com',
        }),
      ).toBe(true);
    });

    it('does not require a context', () => {
      expect(isPasswordAcceptable('anvil poppy quartz drift')).toBe(true);
      expect(isPasswordAcceptable('anvil poppy quartz drift', {})).toBe(true);
    });
  });

  describe('input it must not throw on', () => {
    it.each([
      ['empty', ''],
      ['undefined', undefined],
      ['null', null],
    ])('handles %s', (_label, value) => {
      // Reached from req.body on an unauthenticated route.
      expect(() =>
        checkPassword(value as unknown as string),
      ).not.toThrow();
      expect(isPasswordAcceptable(value as unknown as string)).toBe(false);
    });
  });
});
