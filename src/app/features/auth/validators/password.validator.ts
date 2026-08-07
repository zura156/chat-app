import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/*
 * Mirrors `server/src/auth/services/password-policy.ts`.
 *
 * Read the note at the top of that file for why the rules are what they are.
 * The short version: there used to be three different policies — this one, a
 * regex in the API's router, and `isStrongPassword` on the Mongoose model — and
 * they disagreed, so passwords existed that the form accepted and the API
 * refused. This file now says the same thing the server does.
 *
 * NIST SP 800-63B (rev. 4) §3.1.1 forbids composition rules outright, so the
 * old uppercase/digit/symbol checklist is gone. Length, and not being
 * predictable, is the whole policy.
 *
 * The duplication is deliberate — the two packages have separate builds — and
 * is kept honest by running the same table of cases in both test suites. If you
 * change a rule here, change it there, and update both tables.
 *
 * Never apply this to a *sign-in* field. The rules describe what a password may
 * be set to, not what may be typed to prove you know one; an account created
 * under an older policy must still be able to sign in and move off it. The
 * login form did apply it, which blocked submit and locked those users out of
 * an account whose password was perfectly correct.
 */

/**
 * OWASP ASVS 5.0 6.2.1's L1 floor, chosen over NIST's 15 as a product call —
 * read the block on the same constant in the server file for what that
 * deviation costs. The short version: NIST allows 8 only where a second factor
 * is required and 2FA is opt-in here, so the blocklist below and the breach
 * check on the server are carrying weight the length rule used to.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Counts characters as a person does; `String.length` counts UTF-16 units. */
const passwordLength = (password: string): number => [...password].length;

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
 * written in a non-Latin script to the empty string, which the shape checks
 * then read as "no entropy at all" — so a Georgian, Cyrillic or Chinese
 * passphrase was refused as *predictable*, and mixing in one Latin word made it
 * pass. NIST asks that Unicode be accepted.
 */
const stripSeparators = (value: string): string =>
  value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const deLeet = (value: string): string =>
  [...value].map((character) => LEET[character] ?? character).join('');

/**
 * For shape checks. Leet substitution is deliberately *not* applied: it is
 * correct for word matching and destructive for sequence detection, because
 * `123456789012345678` becomes `i2eas6tb9oi2eas6tb` under it and stops looking
 * like the digit run it is.
 */
const normalizeShape = (password: string): string => {
  const stripped = stripSeparators(password);
  // An all-symbol password strips to nothing, and "nothing" is not "no
  // entropy".
  return stripped || password.replace(/\s+/gu, '');
};

/** For word matching, where seeing through `P@ssw0rd` is the whole point. */
const normalize = (password: string): string =>
  stripSeparators(deLeet(password.toLowerCase()));

const KEYBOARD_ROWS = [
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1234567890',
  'qazwsxedcrfvtgbyhnujmikolp',
];

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

const isRepeatedUnit = (value: string): boolean => {
  for (let unit = 1; unit <= Math.floor(value.length / 2); unit++) {
    if (value.length % unit !== 0) continue;
    const candidate = value.slice(0, unit);
    if (candidate.repeat(value.length / unit) === value) return true;
  }
  return false;
};

/** Every track, in both directions — `poiuytrewq` is as much a walk as `qwerty`. */
const TRACKS: string[] = [...KEYBOARD_ROWS, ALPHABET, DIGITS].flatMap((track) => [
  track,
  [...track].reverse().join(''),
]);

/** Runs shorter than this are ordinary letter adjacency, not a pattern. */
const MIN_RUN = 3;

/**
 * How much of the password is covered by runs — keyboard walks, alphabet or
 * digit sequences, or the same character repeated.
 *
 * Coverage rather than "the longest run", which is too weak for the cases that
 * actually occur: `qwertyuiopasdfgh` is two rows (10 + 6) so its longest run is
 * only 10 of 16, and `123456789012345678` is two overlapping digit runs. Both
 * are entirely pattern and neither has a single run long enough to notice.
 */
const runCoverage = (value: string): number => {
  let covered = 0;
  let index = 0;

  while (index < value.length) {
    let best = 1;

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

/** Almost entirely pattern. Below this a run is just something a real
 *  password happens to contain — `passphrasewithoutlowercase` has `wer` in it. */
const TRIVIAL_COVERAGE = 0.85;

const looksTrivial = (password: string): boolean => {
  const normalized = normalizeShape(password);
  if (normalized.length === 0) return true;
  if (new Set(normalized).size <= 3) return true;
  if (isRepeatedUnit(normalized)) return true;

  return runCoverage(normalized) / normalized.length >= TRIVIAL_COVERAGE;
};

/*
 * The client-side copy of the blocklist is deliberately the same list the
 * server bundles. It is a courtesy — immediate feedback instead of a round trip
 * — and not a control: the server checks this list *and* Have I Been Pwned, and
 * anything that slips past here is refused there.
 *
 * Stored normalised (lower case, de-leeted, letters and digits only), so
 * `P@ssw0rd` is stored as `password`. Most base words are shorter than
 * PASSWORD_MIN_LENGTH and are only ever reached via the trailing-noise
 * candidates in `isCommon` — `monkey12` and `M0nkey!` both reduce to `monkey`.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'passcode',
  'letmein',
  'welcome',
  'iloveyou',
  'trustno',
  'qwerty',
  'monkey',
  'dragon',
  'master',
  'shadow',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'batman',
  'starwars',
  'pokemon',
  'computer',
  'internet',
  'whatever',
  'freedom',
  'secret',
  'admin',
  'administrator',
  'chocolate',
  'cookie',
  'flower',
  'purple',
  'orange',
  'silver',
  'summer',
  'winter',
  'ginger',
  'pepper',
  'soccer',
  'hockey',
  'hunter',
  'ranger',
  'buster',
  'charlie',
  'michael',
  'jessica',
  'jennifer',
  'michelle',
  'samantha',
  'ashley',
  'daniel',
  'thomas',
  'robert',
  'jordan',
  'troubador',

  'passwordpassword',
  'iloveyouforever',
  'letmeinletmein',
  'administratoradmin',
  'qwertyuiopasdfghjkl',
  'welcometothejungle',
  'thequickbrownfox',
  'correcthorsebatterystaple',
  'iloveyousomuch',
  'ilovemyfamily',
  'jesuschristislord',
  'godisgoodallthetime',
  'mynameisnobody',
  'thisisapassword',
  'thisismypassword',
  'nobodywilleverguessthis',
  'idontknowwhattoputhere',
  'iamnotgoingtotellyou',
]);

/** Everything trailing that is not a letter — digits, punctuation, or both. */
const stripTrailingNoise = (value: string): string =>
  value.replace(/[^\p{L}]+$/u, '');

const isCommon = (password: string): boolean => {
  /*
   * Trailing digits are stripped before the leet map, not after. After was
   * wrong in a way that produced the opposite of any intended rule: the leet
   * map turns 0,1,3,4,5,7,8 into letters, so by the time the digit strip ran
   * only 2, 6 and 9 were still digits — `passwordpassword2` was caught and
   * `passwordpassword1` was not.
   */
  const shape = normalizeShape(password);
  const candidates = new Set([
    normalize(password),
    stripSeparators(deLeet(shape.replace(/\d+$/u, ''))),
    /*
     * The only one of the three that catches `P@ssw0rd!`: the shape path strips
     * the `@` as a separator before the leet map can read it as an `a`, and the
     * word path de-leets the trailing `!` into an `i`. Stripping the suffix off
     * the raw password first leaves `password`.
     */
    normalize(stripTrailingNoise(password)),
  ]);

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (COMMON_PASSWORDS.has(candidate)) return true;
    if (candidate.length >= 8 && isRepeatedUnit(candidate)) return true;
  }

  return false;
};

/** What the sign-up and reset forms render as a live checklist. */
export interface PasswordStrength {
  /** At least PASSWORD_MIN_LENGTH characters. */
  hasLength: boolean;
  /** Not more than PASSWORD_MAX_LENGTH. */
  withinMaximum: boolean;
  /** Not a repeat, a keyboard walk or an alphabet run. */
  isUnpredictable: boolean;
  /** Not a well-known password. */
  isUncommon: boolean;
  /** Not built out of the username, the address or the app's name. */
  avoidsIdentity: boolean;
}

export interface PasswordIdentityContext {
  username?: string | null;
  email?: string | null;
}

const identityTerms = (context?: PasswordIdentityContext): string[] =>
  [context?.username ?? '', (context?.email ?? '').split('@')[0] ?? '', 'chatapp']
    .map(normalize)
    .filter((term) => term.length >= 4);

/**
 * `context` is read lazily so the validator can see the sibling username and
 * email controls as they are typed, rather than whatever they held when the
 * form was built.
 */
export const passwordValidator = (
  context: () => PasswordIdentityContext = () => ({}),
): ValidatorFn => {
  return (control: AbstractControl): ValidationErrors | null => {
    const value: string = control.value ?? '';

    // An untouched field is `Validators.required`'s business. Reporting "too
    // short" before anything has been typed lights the form up red on arrival.
    if (!value) return null;

    const length = passwordLength(value);
    const normalized = normalize(value);
    const terms = identityTerms(context());

    const strength: PasswordStrength = {
      hasLength: length >= PASSWORD_MIN_LENGTH,
      withinMaximum: length <= PASSWORD_MAX_LENGTH,
      // Only meaningful once it is long enough; reported as satisfied until
      // then so the checklist does not flag three separate problems for an
      // empty-ish field.
      isUnpredictable: length < PASSWORD_MIN_LENGTH || !looksTrivial(value),
      isUncommon: length < PASSWORD_MIN_LENGTH || !isCommon(value),
      avoidsIdentity:
        length < PASSWORD_MIN_LENGTH ||
        !terms.some((term) => normalized.includes(term)),
    };

    const satisfied = Object.values(strength).every(Boolean);
    return satisfied ? null : { passwordStrength: strength };
  };
};
