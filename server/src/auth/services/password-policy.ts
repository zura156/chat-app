/*
 * The password policy, defined once.
 *
 * There were three, and they disagreed:
 *
 *   - the Angular validator wanted length/uppercase/digit/symbol but no
 *     lowercase, with symbols from [!@#$%^&*(),.?":{}|<>];
 *   - `passwordRule` in auth.router wanted lowercase too, and a symbol from the
 *     much narrower @$!%*?& — and its character class was unanchored, so it
 *     also silently rejected any password whose *first* character was anything
 *     else (`#Passw0rd!` was refused for that reason alone);
 *   - the Mongoose `isStrongPassword` validator wanted one symbol from a third,
 *     wider set.
 *
 * So `PASSW0RD!` passed the form and was refused by the API, `Passw0rd#` passed
 * the form and the model and was refused by the router, and a password set
 * through the old reset flow could fail the login form's own validator — which
 * blocked submit, locking the user out of an account whose password was
 * perfectly correct.
 *
 * ── What replaced them ──────────────────────────────────────────────────────
 *
 * NIST SP 800-63B (rev. 4, 2025) §3.1.1 is explicit, and all three of the above
 * violated it:
 *
 *   "Verifiers and CSPs SHALL NOT impose other composition rules (e.g.,
 *    requiring mixtures of different character types) for passwords."
 *
 * Composition rules do not buy strength. They push users towards `P@ssw0rd1`,
 * which satisfies every rule above and is among the first passwords any
 * cracking dictionary tries, while rejecting `correct horse battery staple` —
 * which all three of the old rules refused and which is vastly stronger.
 *
 * The requirements that replace them, from the same section:
 *
 *   - SHALL be at least 15 characters when the password is the only factor
 *     (8 is permitted only where a second factor is mandatory; here 2FA is
 *     opt-in, so 15 is the applicable floor). See PASSWORD_MIN_LENGTH.
 *     Two-factor enrolment does not lower it: the account existed, with that
 *     password, before the second factor did.
 *   - SHOULD permit at least 64 characters. We allow 128.
 *   - SHALL compare against a blocklist of "commonly used, expected, or
 *     compromised" passwords. See `isCommon` and, for the compromised half,
 *     `breached-password.service`.
 *   - SHOULD accept all printing ASCII, the space character, and Unicode.
 *   - SHALL verify the entire password, not a truncated or trimmed subset.
 *
 * This module is mirrored by the Angular validator in
 * `src/app/features/auth/validators/password.validator.ts`, so the form tells
 * the user the same thing the API would. The two are kept honest by running the
 * identical table of cases in both test suites — see the note there.
 */

/**
 * NIST's floor for a password used as a single factor, and a SHALL rather than
 * a SHOULD:
 *
 *   "Verifiers and CSPs SHALL require passwords that are used as a
 *    single-factor authentication mechanism to be a minimum of 15 characters
 *    in length."
 *
 * The 8-character allowance in the next sentence is a MAY, and applies only to
 * passwords used *only* alongside a second factor. Two-factor is opt-in here,
 * so an account is single-factor unless its owner has chosen otherwise — and
 * at registration, when this is first enforced, no account has.
 *
 * OWASP ASVS 5.0 6.2.1 sets its L1 bar lower, at 8, but "strongly recommends"
 * 15. Nothing current argues for a number in between; ASVS 4.0.3's 12 is
 * superseded.
 */
export const PASSWORD_MIN_LENGTH = 15;

/** Comfortably above the 64 NIST asks for. Only exists to bound bcrypt work. */
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblemCode =
  | 'too_short'
  | 'too_long'
  | 'too_simple'
  | 'common'
  | 'contains_identity';

export interface PasswordProblem {
  code: PasswordProblemCode;
  message: string;
}

export interface PasswordContext {
  username?: string | null;
  email?: string | null;
}

/**
 * Length in characters as a person counts them.
 *
 * `String.length` counts UTF-16 code units, so an emoji is two and an
 * astral-plane character can make a 14-character password "pass" a 15-character
 * check. NIST asks that Unicode be accepted; accepting it means counting it
 * properly.
 */
export const passwordLength = (password: string): number =>
  [...password].length;

/*
 * ── Blocklist ───────────────────────────────────────────────────────────────
 *
 * A 15-character floor does most of this work on its own: almost every entry in
 * the usual "top 10,000 passwords" lists is shorter than that and is already
 * refused. What survives the length check is a much smaller and more structural
 * set — keyboard walks, digit runs, a short word repeated, a common phrase —
 * so this leans on shape detection first and a list second.
 */

/** Undo the substitutions that turn `password` into `P@ssw0rd`. */
const LEET: Record<string, string> = {
  '4': 'a',
  '@': 'a',
  '8': 'b',
  '3': 'e',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '0': 'o',
  '5': 's',
  $: 's',
  '7': 't',
  '+': 't',
};

/**
 * Case-folded, with separators and punctuation removed.
 *
 * `\p{L}\p{N}` rather than `a-z0-9`: the ASCII version reduced any passphrase
 * written in a non-Latin script to the empty string, which `looksTrivial` then
 * read as "no entropy at all". A Georgian, Cyrillic or Chinese passphrase was
 * refused as *predictable*, with no way to satisfy the rule short of switching
 * alphabets — and mixing in one Latin word made it pass, so the failure looked
 * intermittent to anyone reporting it. NIST asks that Unicode be accepted; this
 * is most of what accepting it means.
 */
const stripSeparators = (value: string): string =>
  value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The form used for *shape* checks: case-folded and stripped of separators, but
 * with digits left as digits.
 *
 * Deliberately does not apply the leet map. Doing so is correct for word
 * matching and destructive for sequence detection: `123456789012345678` becomes
 * `i2eas6tb9oi2eas6tb` under the substitutions, which is no longer a digit run
 * at all, and the check that exists to catch exactly that password stopped
 * seeing it.
 */
export const normalizeShape = (password: string): string => {
  const stripped = stripSeparators(password);
  // A password made entirely of symbols — `!@#$%^&*()_+-=[]` — strips to
  // nothing, and "nothing" is not the same as "no entropy". Fall back to the
  // password with only whitespace removed so it is judged on what it contains.
  return stripped || password.replace(/\s+/gu, '');
};

/**
 * The form used for *word* matching: additionally de-leeted, so
 * `P@ssw0rd-P@ssw0rd` and `passwordpassword` reduce to the same string. A
 * blocklist that can be evaded by capitalising a letter is decoration.
 */
const deLeet = (value: string): string =>
  [...value].map((character) => LEET[character] ?? character).join('');

export const normalizeForBlocklist = (password: string): string =>
  stripSeparators(deLeet(password.toLowerCase()));

/** Rows of a QWERTY keyboard, forwards; runs are checked in both directions. */
const KEYBOARD_ROWS = [
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1234567890',
  'qazwsxedcrfvtgbyhnujmikolp', // the common column-walk pattern
];

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

/** Every track, in both directions — `poiuytrewq` is as much a walk as `qwerty`. */
const TRACKS: string[] = [...KEYBOARD_ROWS, ALPHABET, DIGITS].flatMap(
  (track) => [track, [...track].reverse().join('')],
);

/** Runs shorter than this are ordinary letter adjacency, not a pattern. */
const MIN_RUN = 3;

/**
 * How much of the password is covered by runs — walks along a keyboard row or
 * the alphabet, digit sequences, or the same character repeated.
 *
 * Coverage rather than "the longest run", which was the first thing I tried and
 * which is too weak for the cases that actually occur: `qwertyuiopasdfgh` is
 * two rows (10 + 6) so its longest run is only 10 of 16, and
 * `123456789012345678` is two overlapping digit runs of 10 and 8. Both are
 * entirely pattern and neither has a single run long enough to notice.
 *
 * Greedy longest-match, which is not provably optimal but cannot under-count in
 * any way that matters here: a longer run consumed early can only be replaced
 * by shorter ones.
 */
const runCoverage = (value: string): number => {
  let covered = 0;
  let index = 0;

  while (index < value.length) {
    let best = 1;

    // The same character repeated is the degenerate sequence.
    let repeated = 1;
    while (
      index + repeated < value.length &&
      value[index + repeated] === value[index]
    ) {
      repeated++;
    }
    if (repeated >= MIN_RUN) best = repeated;

    for (const track of TRACKS) {
      for (let length = value.length - index; length > best; length--) {
        if (length < MIN_RUN) break;
        if (track.includes(value.slice(index, index + length))) {
          best = length;
          break;
        }
      }
    }

    if (best >= MIN_RUN) covered += best;
    index += best;
  }

  return covered;
};

/**
 * Whether the password is one short unit repeated — `abcabcabcabcabc`,
 * `passwordpassword`, `aaaaaaaaaaaaaaaa`.
 *
 * Length alone says nothing about strength when the characters are not
 * independent; this is the cheapest way to catch the case where they are not.
 */
const isRepeatedUnit = (value: string): boolean => {
  for (let unit = 1; unit <= Math.floor(value.length / 2); unit++) {
    if (value.length % unit !== 0) continue;
    const candidate = value.slice(0, unit);
    if (candidate.repeat(value.length / unit) === value) return true;
  }
  return false;
};

/**
 * Structural weakness that no wordlist could enumerate: too few distinct
 * characters, a repeated unit, or a long walk along the keyboard or alphabet.
 */
/**
 * Almost entirely pattern. Below this a run is just something a real password
 * happens to contain — `passphrasewithoutlowercase` has `wer` in it.
 */
const TRIVIAL_COVERAGE = 0.85;

export const looksTrivial = (password: string): boolean => {
  const normalized = normalizeShape(password);
  if (normalized.length === 0) return true;

  // `Aaaaaaaaaaaaaaa!` is sixteen characters and one bit of entropy.
  if (new Set(normalized).size <= 3) return true;

  if (isRepeatedUnit(normalized)) return true;

  return runCoverage(normalized) / normalized.length >= TRIVIAL_COVERAGE;
};

/**
 * Long-form passwords that survive the length check and the shape checks but
 * are still among the first things any attacker tries.
 *
 * Deliberately short. It exists for the handful of cases structure cannot see;
 * the real defence against compromised passwords is the Have I Been Pwned check
 * in `breached-password.service`, which covers hundreds of millions of them.
 */
const COMMON_PASSWORDS = new Set([
  'passwordpassword',
  'password12345678',
  'passwordpassword1',
  'iloveyouforever',
  'letmeinletmein',
  'trustno1trustno1',
  'administratoradmin',
  'qwertyuiopasdfghjkl',
  'welcometothejungle',
  'thequickbrownfox',
  'correcthorsebatterystaple', // the xkcd example, and therefore in every list
  'iloveyousomuch',
  'ilovemyfamily',
  'jesuschristislord',
  'godisgoodallthetime',
  'chatappchatapp',
  'superman12345678',
  'princess12345678',
  'mynameisnobody',
  'thisisapassword',
  'thisismypassword',
  'nobodywilleverguessthis',
  'idontknowwhattoputhere',
  'iamnotgoingtotellyou',
]);

/**
 * Whether the password matches a known-common one once normalised. Trailing
 * digits are stripped for a second attempt so `password12345678` is caught by
 * the entry `password`, which is the shape people actually reach for when a
 * length rule bites.
 */
export const isCommon = (password: string): boolean => {
  /*
   * Trailing digits are stripped before the leet map, not after.
   *
   * After was wrong in a way that produced the opposite of any intended rule:
   * the leet map turns 0,1,3,4,5,7,8 into letters, so by the time `\d+$` ran
   * only 2, 6 and 9 were still digits. `passwordpassword2` was caught and
   * `passwordpassword1` was not.
   */
  const shape = normalizeShape(password);
  const candidates = new Set([
    normalizeForBlocklist(password),
    stripSeparators(deLeet(shape.replace(/\d+$/u, ''))),
  ]);

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (COMMON_PASSWORDS.has(candidate)) return true;
    // `password` alone is under the length floor and never reaches here on its
    // own, but `passwordpassword1` reduces to a repeat of it.
    if (candidate.length >= 8 && isRepeatedUnit(candidate)) return true;
  }

  return false;
};

/**
 * Terms drawn from the account itself. NIST calls these "expected" passwords
 * and asks for them explicitly: a password derived from the username or the
 * address is public knowledge with a suffix.
 */
const identityTerms = (context?: PasswordContext): string[] => {
  const terms = [
    context?.username ?? '',
    (context?.email ?? '').split('@')[0] ?? '',
    'chatapp',
  ];

  return terms
    .map((term) => normalizeForBlocklist(term))
    // Anything very short would match far too much: a username of "al" would
    // reject every password containing those letters together.
    .filter((term) => term.length >= 4);
};

const containsIdentity = (
  password: string,
  context?: PasswordContext,
): boolean => {
  const normalized = normalizeForBlocklist(password);
  return identityTerms(context).some((term) => normalized.includes(term));
};

/**
 * Every reason this password is unacceptable, or an empty array.
 *
 * Returns all of them rather than the first: the sign-up form renders them as a
 * list, and reporting one at a time turns setting a password into a guessing
 * game. Deliberately synchronous and side-effect free — the network-dependent
 * breach check is separate, because it must be able to fail without taking
 * registration down with it.
 */
export const checkPassword = (
  password: string,
  context?: PasswordContext,
): PasswordProblem[] => {
  const problems: PasswordProblem[] = [];
  const length = passwordLength(password ?? '');

  if (length < PASSWORD_MIN_LENGTH) {
    problems.push({
      code: 'too_short',
      message: `Use at least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words is the easiest way to get there.`,
    });
  }

  if (length > PASSWORD_MAX_LENGTH) {
    problems.push({
      code: 'too_long',
      message: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
    });
  }

  // Only worth saying once the length is plausible; telling someone their
  // three-character password is "too simple" is noise on top of "too short".
  if (length >= PASSWORD_MIN_LENGTH) {
    if (looksTrivial(password)) {
      problems.push({
        code: 'too_simple',
        message:
          'This is too predictable — it repeats, or runs along the keyboard or alphabet.',
      });
    }

    if (isCommon(password)) {
      problems.push({
        code: 'common',
        message: 'This is a well-known password. Choose something else.',
      });
    }

    if (containsIdentity(password, context)) {
      problems.push({
        code: 'contains_identity',
        message:
          'Do not build your password out of your username, your email address or the name of this app.',
      });
    }
  }

  return problems;
};

/** Convenience for the call sites that only need a yes or no. */
export const isPasswordAcceptable = (
  password: string,
  context?: PasswordContext,
): boolean => checkPassword(password, context).length === 0;
