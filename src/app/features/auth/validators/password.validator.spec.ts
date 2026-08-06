import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordIdentityContext,
  passwordValidator,
} from './password.validator';

/*
 * The sign-up and reset-password policy.
 *
 * Two things make this worth testing closely. First, the register and reset
 * forms render a live checklist straight off the error payload, so the *shape*
 * of that payload is the UI — dropping a key silently removes a row rather
 * than throwing. Second, this file is a deliberate duplicate of
 * `server/src/auth/services/password-policy.ts`, and the two are only kept
 * honest by tests: a rule that drifts here produces a password the form
 * accepts and the API refuses, with the error landing on a field the form said
 * was fine.
 *
 * The policy follows NIST SP 800-63B, which forbids composition rules — so
 * there is deliberately no "must contain an uppercase letter" here, and tests
 * asserting the absence of those rules are as load-bearing as the ones
 * asserting presence.
 */

const validate = (value: unknown, context: PasswordIdentityContext = {}) =>
  passwordValidator(() => context)(new FormControl(value));

/** The failing rules, which is what the checklist actually renders. */
const failures = (value: unknown, context: PasswordIdentityContext = {}) => {
  const errors = validate(value, context);
  if (!errors) return [];
  const strength = errors['passwordStrength'] as Record<string, boolean>;
  return Object.entries(strength)
    .filter(([, met]) => !met)
    .map(([rule]) => rule)
    .sort();
};

const WORDS =
  'quiet river flows past old stone bridges at dawn while birds sing softly in tall green trees near the village market every morning before autumn'.split(
    ' ',
  );

/** A non-trivial passphrase of an exact length, for the boundary cases. */
const passphraseOf = (length: number): string => {
  let value = '';
  let index = 0;
  while ([...value].length < length)
    value += (value ? '-' : '') + WORDS[index++ % WORDS.length];
  return [...value].slice(0, length).join('');
};

describe('passwordValidator', () => {
  it('accepts an ordinary passphrase', () => {
    expect(validate('a-quiet-tuesday-afternoon')).toBeNull();
    expect(validate('purple-monkey-dishwasher')).toBeNull();
    expect(validate('MyStrongPassphrase42')).toBeNull();
  });

  it('ignores an empty control, leaving that to Validators.required', () => {
    // Reporting "too short" on an untouched field lights the form up red
    // before the user has typed anything.
    expect(validate('')).toBeNull();
    expect(validate(null)).toBeNull();
    expect(validate(undefined)).toBeNull();
  });

  describe('length', () => {
    it('requires the documented minimum', () => {
      expect(PASSWORD_MIN_LENGTH).toBe(15);
      expect(failures('blue-coffee-la')).toEqual(['hasLength']);
      expect(validate('blue-coffee-lam')).toBeNull();
    });

    it('accepts exactly the maximum and refuses one more', () => {
      // The cap exists because bcrypt-style hashing costs scale with input;
      // it is not a strength rule, so the boundary belongs to the server too.
      expect(PASSWORD_MAX_LENGTH).toBe(128);
      expect(validate(passphraseOf(PASSWORD_MAX_LENGTH))).toBeNull();
      expect(failures(passphraseOf(PASSWORD_MAX_LENGTH + 1))).toEqual([
        'withinMaximum',
      ]);
    });

    it('counts characters as a person does, not as UTF-16 units', () => {
      /*
       * `String.length` counts surrogate halves, so an emoji is two. A
       * password of 14 visible characters containing emoji measures 18 by that
       * count and would sail past a naive check — while the server, counting
       * the same way this does, refuses it.
       */
      const password = 'ok🎤'.repeat(4) + 'ab';
      expect(password.length).toBe(18);
      expect([...password].length).toBe(14);
      expect(failures(password)).toContain('hasLength');
    });

    it('reports only the length while the password is too short', () => {
      /*
       * The other rules are suppressed below the minimum on purpose: a
       * half-typed password is trivially a keyboard run and trivially matches
       * something, and flagging four failures at once while the user is still
       * typing the first word is noise.
       */
      expect(failures('aaa')).toEqual(['hasLength']);
      expect(failures('qwerty')).toEqual(['hasLength']);
      expect(failures('password')).toEqual(['hasLength']);
    });
  });

  describe('no composition rules', () => {
    /*
     * NIST SP 800-63B §3.1.1 forbids these outright, and the old checklist
     * (uppercase / digit / symbol) is gone. These are pinned as *absences* —
     * a well-meaning re-addition would be a policy regression, and would put
     * the form back out of step with the server.
     */

    it('accepts a passphrase with no uppercase letter', () => {
      expect(validate('the-mountain-air-is-cold')).toBeNull();
    });

    it('accepts a passphrase with no digit', () => {
      expect(validate('jump-fox-lazy-dog-river')).toBeNull();
    });

    it('accepts a passphrase with no symbol', () => {
      expect(validate('MyStrongPassphrase42')).toBeNull();
    });

    it('accepts letters only, no digits or symbols at all', () => {
      expect(validate('purple monkey dishwasher')).toBeNull();
    });
  });

  describe('predictability', () => {
    it('rejects an alphabet run', () => {
      expect(failures('abcdefghijklmno')).toEqual(['isUnpredictable']);
      expect(failures('abcdefghijklmnopq')).toEqual(['isUnpredictable']);
    });

    it('rejects a run written backwards', () => {
      // The tracks are searched in both directions; without that, reversing a
      // keyboard row is a free bypass.
      expect(failures('zyxwvutsrqponml')).toEqual(['isUnpredictable']);
    });

    it('rejects a password built from three or fewer distinct characters', () => {
      expect(failures('aaaaaaaaaaaaaaa')).toContain('isUnpredictable');
      expect(failures('abababababababab')).toContain('isUnpredictable');
    });

    it('rejects a repeated unit', () => {
      expect(failures('passwordpassword')).toContain('isUnpredictable');
    });

    it('sees through leet substitution', () => {
      // `Passw0rdPassw0rd` normalises to `passwordpassword`; a check on the
      // raw string would see two distinct halves.
      expect(failures('Passw0rdPassw0rd')).toContain('isUnpredictable');
    });

    it('accepts a passphrase that merely contains a short run', () => {
      // The threshold scales with length, so an incidental "abc" inside a real
      // passphrase must not trip it.
      expect(validate('abc-quiet-river-flows-past')).toBeNull();
    });
  });

  describe('the common-password list', () => {
    it('rejects a password on the list', () => {
      expect(failures('correct-horse-battery-staple')).toEqual(['isUncommon']);
      expect(failures('thisisapassword')).toEqual(['isUncommon']);
    });

    it('ignores punctuation and case when matching', () => {
      // The list is stored normalised, so a user's hyphens and capitals do not
      // buy them anything.
      expect(failures('I-Love-You-For-Ever')).toContain('isUncommon');
    });

    it('is a courtesy, not the control', () => {
      /*
       * Deliberately the same short list the server bundles: this exists to
       * give immediate feedback instead of a round trip. The server checks
       * this list *and* Have I Been Pwned, so anything that slips past here is
       * still refused on submit. That is the safety net for the gap below.
       */
      expect(validate('a-quiet-tuesday-afternoon')).toBeNull();
    });
  });

  describe('identity', () => {
    it('rejects a password built from the username', () => {
      expect(failures('zura156-quiet-river-flows', { username: 'zura156' })).toEqual(
        ['avoidsIdentity'],
      );
    });

    it('rejects a password built from the email local part', () => {
      // The domain is not a term — everyone at a company shares it, so it
      // would refuse half of a workplace's legitimate passphrases.
      expect(
        failures('gagnidze-quiet-river-flow', { email: 'gagnidze@example.com' }),
      ).toEqual(['avoidsIdentity']);
      expect(
        validate('example.com-quiet-river-flows', {
          email: 'gagnidze@example.com',
        }),
      ).toBeNull();
    });

    it('always rejects a password built from the app name', () => {
      expect(failures('chatapp-quiet-river-flows')).toEqual(['avoidsIdentity']);
    });

    it('sees through leet substitution in the identity term too', () => {
      expect(failures('ch4t4pp-quiet-river-flows')).toEqual(['avoidsIdentity']);
      expect(failures('zur4156-quiet-river-flows', { username: 'zura156' })).toEqual(
        ['avoidsIdentity'],
      );
    });

    it('ignores an identity term shorter than four characters', () => {
      // A two- or three-letter username appears inside ordinary words; taking
      // it seriously would refuse most passphrases the user could think of.
      expect(validate('abc-quiet-river-flows-past', { username: 'abc' })).toBeNull();
    });

    it('accepts the same password when there is no context', () => {
      // Confirms the rejections above come from the context and not from the
      // string itself.
      expect(validate('zura156-quiet-river-flows')).toBeNull();
    });

    it('reads the context on each run, not when the validator is built', () => {
      /*
       * The username and email are sibling controls being typed at the same
       * time as the password. A context captured at build time is whatever the
       * form held when it was constructed — usually empty — so the rule would
       * never fire on the sign-up form, which is the only place it matters.
       */
      let username = 'nobody';
      const validator = passwordValidator(() => ({ username }));
      const control = new FormControl('zura156-quiet-river-flows');

      expect(validator(control)).toBeNull();

      username = 'zura156';
      expect(validator(control)).not.toBeNull();
    });

    it('defaults to no context when called with no argument', () => {
      // Used by the reset-password form, which has no username field on screen.
      expect(passwordValidator()(new FormControl('blue-coffee-lamp'))).toBeNull();
    });
  });

  describe('the error payload the checklist renders', () => {
    it('reports every rule, met or not, in one object', () => {
      // The checklist shows all five states at once; a payload carrying only
      // the failures would render the rest as unknown.
      const errors = validate('aaa');
      expect(errors).toEqual({
        passwordStrength: {
          hasLength: false,
          withinMaximum: true,
          isUnpredictable: true,
          isUncommon: true,
          avoidsIdentity: true,
        },
      });
    });

    it('reports several failures together', () => {
      const errors = validate('aaaaaaaaaaaaaaa');
      expect(errors!['passwordStrength']).toMatchObject({
        hasLength: true,
        isUnpredictable: false,
        isUncommon: false,
      });
    });

    it('returns null rather than an all-true payload when the password is good', () => {
      // The form tests for the error's presence, not for its contents.
      expect(validate('a-quiet-tuesday-afternoon')).toBeNull();
    });
  });

  describe('evasions an earlier draft of this validator allowed', () => {
    /*
     * Each of these passed a previous version and is now refused. They are kept
     * as tests rather than deleted because every one is the obvious next thing
     * a user reaches for when a length rule bites, and each was one
     * plausible-looking implementation away from coming back.
     */

    it('is not fooled by a trailing digit, whichever digit it is', () => {
      /*
       * The blocklist bypass check strips trailing digits before re-testing.
       * It used to do that *after* the leet map, which turns 0,1,3,4,5,7,8 into
       * letters — so only 2, 6 and 9 were still digits by then, and
       * `passwordpassword1` was accepted while `passwordpassword2` was not.
       * Stripping before the map makes all ten behave the same.
       */
      for (const digit of '0123456789') {
        expect(failures(`passwordpassword${digit}`)).toContain('isUncommon');
      }
    });

    it('catches a keyboard walk that spans two rows', () => {
      // Measuring "the longest single run" missed these: `qwertyuiop` is 10 of
      // 15 characters and the remainder is a second, shorter run. Counting the
      // share of the password covered by runs catches both.
      expect(failures('qwertyuiopasdfg')).toContain('isUnpredictable');
      expect(failures('1234567890qwert')).toContain('isUnpredictable');
    });

    it('catches a fifteen-digit number', () => {
      // Two overlapping digit runs, neither long enough alone under the old rule.
      expect(failures('123456789012345')).toContain('isUnpredictable');
    });
  });

  describe('non-Latin scripts', () => {
    /*
     * Normalisation used to strip everything outside [a-z0-9], so a passphrase
     * in any other script reduced to the empty string — which the shape check
     * read as "no entropy at all" and refused as *predictable*. There was no way
     * to satisfy the rule short of switching alphabets, and mixing in a single
     * Latin word made it pass, so the failure looked intermittent to anyone
     * reporting it.
     *
     * NIST SP 800-63B: verifiers SHOULD accept Unicode characters in passwords.
     */

    it.each([
      ['Georgian', 'გამარჯობა მეგობარო როგორ ხარ'],
      ['Cyrillic', 'привет-как-дела-друг-мой'],
      ['Chinese', '我喜欢喝咖啡在早上的时候真好啊'],
      ['Greek', 'καλημέρα φίλε μου τι κάνεις'],
    ])('accepts a passphrase in %s', (_script, password) => {
      expect(validate(password)).toBeNull();
    });

    it('still applies the shape rules within a non-Latin script', () => {
      // Accepting Unicode is not the same as exempting it.
      expect(failures('ააააააააააააააააა')).toContain('isUnpredictable');
    });

    it('counts non-Latin characters towards the minimum length', () => {
      expect(failures('გამარჯობა')).toEqual(['hasLength']);
    });

    it('accepts a password made only of symbols', () => {
      // Stripping separators leaves nothing, and "nothing" is not "no entropy".
      expect(validate('!@#$%^&*()_+-=[]{}')).toBeNull();
    });
  });
});
