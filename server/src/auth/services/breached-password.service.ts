import crypto from 'crypto';
import config from '../../config/config';
import { logger } from '../../utils/logger';

/*
 * The "compromised" half of NIST SP 800-63B §3.1.1's blocklist requirement:
 *
 *   "Verifiers SHALL compare the prospective secret against a blocklist that
 *    contains known commonly used, expected, or compromised passwords."
 *
 * `password-policy` covers "commonly used" and "expected" from a bundled list
 * and from the account's own details. "Compromised" cannot be covered that way
 * — the corpus is hundreds of millions of entries — so this asks Have I Been
 * Pwned, which is the standard answer.
 *
 * ── The password is never sent ──────────────────────────────────────────────
 *
 * k-anonymity: SHA-1 the password, send the *first five hex characters* of the
 * digest, and receive every suffix HIBP holds under that prefix — several
 * hundred of them. The comparison happens here. The service learns five hex
 * characters, which match roughly one in a million of its corpus, and never
 * sees the password, the full hash, the account or the address.
 *
 * SHA-1 is not a security choice here; it is the digest HIBP's range API is
 * keyed on. Nothing is stored, and the password's own hashing is bcrypt.
 */

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';

/** Short: this sits in the path of registration and password changes. */
const REQUEST_TIMEOUT_MS = 2_500;

const sha1Upper = (value: string): string =>
  crypto.createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();

/**
 * How many breaches this password appears in. Zero when it is unknown *or* when
 * the check could not be made — see `isBreachedPassword` for why that is the
 * right failure mode.
 */
const countBreaches = async (password: string): Promise<number> => {
  const digest = sha1Upper(password);
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  const response = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
    headers: {
      // Asks HIBP to pad the response with random entries, so the size of the
      // reply does not leak how many real hashes share the prefix.
      'Add-Padding': 'true',
      'User-Agent': 'chat-app-password-check',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HIBP responded ${response.status}`);
  }

  const body = await response.text();

  for (const line of body.split('\n')) {
    const [candidate, count] = line.trim().split(':');
    if (candidate === suffix) {
      // Padded entries are returned with a count of 0.
      return Number.parseInt(count ?? '0', 10) || 0;
    }
  }

  return 0;
};

/*
 * ── When HIBP cannot be reached ─────────────────────────────────────────────
 *
 * The check is on by default, so an environment without outbound HTTPS would
 * otherwise pay REQUEST_TIMEOUT_MS on every registration and every password
 * change, forever, to reach the same fail-open answer. After a few consecutive
 * failures the circuit opens and calls return immediately for a cooldown; the
 * next call afterwards retries. A sustained outage therefore costs one timeout
 * and one log line per cooldown, rather than one of each per user.
 */
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

/** Test seam: the breaker is module state and would otherwise leak between specs. */
export const resetBreachedPasswordCircuit = (): void => {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
};

/**
 * Whether this password appears in a known breach.
 *
 * On unless `CHECK_BREACHED_PASSWORDS=false`. NIST SP 800-63B rev. 4 §3.1.1.2
 * SHALL-requires comparison against known compromised passwords, and a bundled
 * list cannot cover a corpus of that size — so this is the part of the policy
 * that actually meets the requirement.
 *
 * **Fails open, deliberately.** A refusal here is indistinguishable to the user
 * from "your password is fine but our vendor is down", and the alternative —
 * failing closed — means an HIBP outage blocks every registration and every
 * password reset, including the resets of people trying to recover a
 * compromised account. The local policy checks still apply and are unaffected.
 * The failure is logged so it is visible rather than silent.
 */
export const isBreachedPassword = async (password: string): Promise<boolean> => {
  if (!config.checkBreachedPasswords) return false;
  if (Date.now() < circuitOpenUntil) return false;

  try {
    const breached = (await countBreaches(password)) > 0;
    consecutiveFailures = 0;
    return breached;
  } catch (error) {
    consecutiveFailures += 1;

    if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      consecutiveFailures = 0;
      logger.error(
        `Breached-password check failed ${CIRCUIT_FAILURE_THRESHOLD} times in a row; ` +
          `skipping it for ${CIRCUIT_COOLDOWN_MS / 1000}s. Passwords are still ` +
          'checked against the local policy, but not against known breaches.',
        error,
      );
    } else {
      logger.error(
        'Breached-password check failed; allowing the password. ' +
          'The local policy checks still applied.',
        error,
      );
    }

    return false;
  }
};
