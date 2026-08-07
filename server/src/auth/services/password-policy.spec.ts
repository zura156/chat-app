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
    {
      password: 'kite-fog',
      acceptable: true,
      why: 'exactly the minimum — short is allowed, predictable is not',
    },

    // ── Refused ───────────────────────────────────────────────────────────
    {
      password: 'P@ssw0rd!',
      acceptable: false,
      why: 'long enough under an 8-character floor, so the blocklist is the only thing refusing it — and it must',
    },
    {
      password: 'password1',
      acceptable: false,
      why: 'the suffix people add when a rule bites; strips to a listed base word',
    },
    {
      password: 'M0nkey!!',
      acceptable: false,
      why: 'a dictionary word in leetspeak with punctuation bolted on — the whole shape a short floor invites',
    },
    {
      password: 'iloveyou',
      acceptable: false,
      why: 'eight characters, no repeat, no walk: nothing but the blocklist sees anything wrong with it',
    },
    {
      password: 'Tr0ub4dor&3',
      acceptable: false,
      why: 'the canonical "complex but short" password',
    },
    {
      password: 'kite-fo',
      acceptable: false,
      why: 'one character below the minimum',
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
  it('is the documented floor', () => {
    /*
     * Pinned exactly, not as a lower bound, because this number is a deliberate
     * deviation from SP 800-63B rev. 4 §3.1.1 — which SHALL-requires 15 for a
     * single-factor password and permits 8 only alongside a required second
     * factor, and 2FA is opt-in here. It is OWASP ASVS 5.0 6.2.1's L1 bar.
     *
     * Changing it is a security decision, not a tuning knob: at 8, the
     * blocklist and the HIBP check are load-bearing in a way they were not at
     * 15. Anyone editing this line should read the block on the constant first.
     */
    expect(PASSWORD_MIN_LENGTH).toBe(8);
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
      // Seven emoji are fourteen code units. Counting those would let a
      // 7-character password satisfy an 8-character rule.
      const emoji = '🙂'.repeat(7);
      expect(emoji.length).toBe(14);
      expect(passwordLength(emoji)).toBe(7);
      expect(checkPassword(emoji).map((p) => p.code)).toContain('too_short');
    });

    it('does not trim, because trimming would change the password', () => {
      // NIST: verify the entire submitted password, not a subset of it.
      const padded = '   anvil poppy quartz   ';
      expect(passwordLength(padded)).toBe(padded.length);
      expect(isPasswordAcceptable(padded)).toBe(true);
    });
  });

  describe('the short end, which the length floor used to cover', () => {
    /*
     * At 15 characters almost every entry in a "top 10,000 passwords" list was
     * refused on length before any rule here could name it, and the blocklist
     * was deliberately thin because of it. At 8 they are all length-legal, and
     * none of them repeats, walks the keyboard or runs along the alphabet — so
     * `looksTrivial` sees nothing wrong and the list is the only thing left.
     *
     * These are the cases that were free before and are not now.
     */

    it.each([
      'password',
      'iloveyou',
      'princess',
      'football',
      'baseball',
      'superman',
      'starwars',
      'computer',
      'sunshine',
    ])('refuses the bare dictionary word %s', (password) => {
      // Each is exactly at or above the floor and structurally unremarkable.
      expect(passwordLength(password)).toBeGreaterThanOrEqual(
        PASSWORD_MIN_LENGTH,
      );
      expect(checkPassword(password).map((p) => p.code)).toContain('common');
    });

    it.each([
      ['a trailing digit', 'monkey12'],
      ['a longer digit run', 'princess2024'],
      ['trailing punctuation', 'letmein!!'],
      ['both, in either order', 'password1!'],
      ['both, the other way round', 'password!1'],
      ['leetspeak', 'M0nkey12'],
      ['leetspeak and punctuation', 'P@ssw0rd!'],
      ['separators', 'p-a-s-s-w-o-r-d'],
    ])('sees through %s', (_label, password) => {
      expect(checkPassword(password).map((p) => p.code)).toContain('common');
    });

    it('does not refuse a passphrase merely for containing a listed word', () => {
      // The list is matched by equality, never as a substring — otherwise
      // `monkey` would reject every passphrase with a monkey in it.
      expect(isPasswordAcceptable('monkey lantern quartz')).toBe(true);
      expect(isPasswordAcceptable('purple monkey dishwasher')).toBe(true);
      expect(isPasswordAcceptable('freedom of the tangerine press')).toBe(true);
    });

    it('accepts a short password that is simply not predictable', () => {
      // The point of the lower floor. These must not be collateral damage.
      for (const password of ['kite-fog', 'vex7harp', 'plumdrift']) {
        expect(isPasswordAcceptable(password)).toBe(true);
      }
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
