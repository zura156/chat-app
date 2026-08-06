import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../../config/config';
import {
  isBreachedPassword,
  resetBreachedPasswordCircuit,
} from './breached-password.service';

/*
 * The k-anonymity contract is the part that matters here: if this ever sent
 * more than five hex characters of the digest it would be handing a third party
 * a password hash, and nothing about the feature would look different from the
 * outside. Everything below is really guarding that one property, plus the
 * fail-open behaviour that keeps an outage at HIBP from blocking every
 * registration and password reset on the service.
 */

const PASSWORD = 'a-quiet-tuesday-afternoon';

const digestOf = (password: string) =>
  crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();

/**
 * Replaces global fetch for one test and hands back the mock so the request can
 * be inspected. `vi.stubGlobal` rather than `vi.spyOn`, because `restoreAllMocks`
 * in afterEach tears a spy down permanently — after which the remaining tests
 * quietly reach the real network, fail open, and report `false` for everything.
 */
const stubFetch = (
  handler: () => Promise<Response>,
): ReturnType<typeof vi.fn> => {
  const mock = vi.fn(handler);
  vi.stubGlobal('fetch', mock);
  return mock;
};

const responding = (body: string, status = 200) =>
  async () => new Response(body, { status });

describe('isBreachedPassword', () => {
  const flag = config as { checkBreachedPasswords: boolean };
  const original = flag.checkBreachedPasswords;

  beforeEach(() => {
    // `config` is a plain object literal and the service reads the flag on
    // every call, so setting it here is enough.
    flag.checkBreachedPasswords = true;
    // The breaker is module-level state: three throwing tests in a row would
    // otherwise open it and make every test after them a no-op that still
    // passes, because a skipped check and a failed one both return false.
    resetBreachedPasswordCircuit();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    flag.checkBreachedPasswords = original;
    resetBreachedPasswordCircuit();
  });

  it('does nothing at all when the feature is off', async () => {
    (config as { checkBreachedPasswords: boolean }).checkBreachedPasswords =
      false;
    const mock = stubFetch(responding(''));

    expect(await isBreachedPassword(PASSWORD)).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });

  it('sends only the first five characters of the digest, never the password', async () => {
    const digest = digestOf(PASSWORD);
    const mock = stubFetch(responding(`${digest.slice(5)}:42`));

    await isBreachedPassword(PASSWORD);

    const [url] = mock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`);

    // The three things that must never appear in the request.
    expect(url).not.toContain(PASSWORD);
    expect(url).not.toContain(digest);
    expect(url).not.toContain(digest.slice(5));
  });

  it('asks for padding, so the reply size leaks nothing', async () => {
    const mock = stubFetch(responding(''));

    await isBreachedPassword(PASSWORD);

    const [, init] = mock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers['Add-Padding']).toBe('true');
  });

  it('reports a password whose suffix comes back with a count', async () => {
    const suffix = digestOf(PASSWORD).slice(5);
    stubFetch(responding(`0000000000000000000000000000000000A:3\n${suffix}:1874`));

    expect(await isBreachedPassword(PASSWORD)).toBe(true);
  });

  it('clears a password whose suffix is absent from the range', async () => {
    stubFetch(responding('0000000000000000000000000000000000A:3'));

    expect(await isBreachedPassword(PASSWORD)).toBe(false);
  });

  it('treats a padded entry as not breached', async () => {
    // Padding entries are returned with a count of zero; counting them would
    // reject essentially every password.
    const suffix = digestOf(PASSWORD).slice(5);
    stubFetch(responding(`${suffix}:0`));

    expect(await isBreachedPassword(PASSWORD)).toBe(false);
  });

  it('matches the suffix case-insensitively against the API’s uppercase', async () => {
    const suffix = digestOf(PASSWORD).slice(5);
    expect(suffix).toBe(suffix.toUpperCase());
    stubFetch(responding(`${suffix}:9`));

    expect(await isBreachedPassword(PASSWORD)).toBe(true);
  });

  it('tolerates the carriage returns HIBP actually sends', async () => {
    const suffix = digestOf(PASSWORD).slice(5);
    stubFetch(responding(`${suffix}:5\r\n`));

    expect(await isBreachedPassword(PASSWORD)).toBe(true);
  });

  describe('failing open', () => {
    /*
     * Deliberate, and the most consequential decision in this file. Failing
     * closed would mean an HIBP outage blocks every registration and every
     * password reset — including the resets of people trying to recover an
     * account they know is compromised. The local policy checks are unaffected
     * either way.
     */

    it('allows the password when the request throws', async () => {
      stubFetch(async () => {
        throw new Error('network down');
      });

      expect(await isBreachedPassword(PASSWORD)).toBe(false);
    });

    it('allows the password when the API answers with an error status', async () => {
      stubFetch(responding('', 503));
      expect(await isBreachedPassword(PASSWORD)).toBe(false);
    });

    it('allows the password when the request times out', async () => {
      stubFetch(async () => {
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      });

      expect(await isBreachedPassword(PASSWORD)).toBe(false);
    });

    it('never rejects, whatever happens', async () => {
      stubFetch(async () => {
        throw new Error('boom');
      });

      // It sits in the request path of registration; a rejection here is a 500
      // on an otherwise valid sign-up.
      await expect(isBreachedPassword(PASSWORD)).resolves.toBe(false);
    });
  });

  describe('the default', () => {
    /*
     * NIST SP 800-63B rev. 4 §3.1.1.2 SHALL-requires comparison against known
     * compromised passwords, and a bundled list cannot cover a breach corpus.
     * Defaulting this off would mean a deployment that changed nothing did not
     * meet the requirement — so it is opt-out, unlike every other flag in
     * `config`, which is opt-in.
     *
     * Re-imports `config` under a stubbed environment rather than reading the
     * already-loaded value, which would only tell us what this machine's
     * environment happens to say.
     */
    const loadWith = async (value: string | undefined): Promise<boolean> => {
      vi.resetModules();
      vi.stubEnv('CHECK_BREACHED_PASSWORDS', value);
      const fresh = (await import('../../config/config')).default;
      return fresh.checkBreachedPasswords;
    };

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it('is on when nothing is configured', async () => {
      expect(await loadWith(undefined)).toBe(true);
    });

    it('is off only for an explicit false', async () => {
      expect(await loadWith('false')).toBe(false);
      expect(await loadWith('true')).toBe(true);
    });

    it('stays on for a value that is not the literal false', async () => {
      // `CHECK_BREACHED_PASSWORDS=0` means "on", which is surprising — but the
      // surprise is in the safe direction, and matching only the documented
      // literal keeps this the exact mirror of the opt-in flags beside it.
      expect(await loadWith('0')).toBe(true);
      expect(await loadWith('no')).toBe(true);
      expect(await loadWith('')).toBe(true);
    });
  });

  describe('when HIBP is unreachable', () => {
    /*
     * The cost of on-by-default. Without a breaker, an environment with no
     * outbound HTTPS pays the full request timeout on every registration and
     * every password change, forever, to arrive at the same fail-open answer —
     * and writes a log line each time.
     */

    const failing = () =>
      stubFetch(async () => {
        throw new Error('network down');
      });

    it('keeps trying while failures are occasional', async () => {
      const mock = failing();

      await isBreachedPassword(PASSWORD);
      await isBreachedPassword(PASSWORD);

      expect(mock).toHaveBeenCalledTimes(2);
    });

    it('stops calling out once failures are consecutive', async () => {
      const mock = failing();

      for (let i = 0; i < 5; i += 1) await isBreachedPassword(PASSWORD);

      // Three to trip it; the remaining two short-circuit.
      expect(mock).toHaveBeenCalledTimes(3);
    });

    it('still allows the password while the breaker is open', async () => {
      failing();
      for (let i = 0; i < 3; i += 1) await isBreachedPassword(PASSWORD);

      // Fail-open has to survive the optimisation, or a network blip becomes a
      // minute of blocked registrations.
      expect(await isBreachedPassword(PASSWORD)).toBe(false);
    });

    it('a success resets the count, so failures must be consecutive', async () => {
      const suffix = digestOf(PASSWORD).slice(5);
      let attempt = 0;
      const mock = vi.fn(async () => {
        attempt += 1;
        // Fails, fails, succeeds, fails, fails — never three in a row.
        if (attempt === 3) return new Response(`${suffix}:7`);
        throw new Error('network down');
      });
      vi.stubGlobal('fetch', mock);

      const results: boolean[] = [];
      for (let i = 0; i < 5; i += 1) results.push(await isBreachedPassword(PASSWORD));

      expect(mock).toHaveBeenCalledTimes(5);
      expect(results[2]).toBe(true);
    });

    it('retries once the cooldown has passed', async () => {
      // Only Date is faked: the service reads the clock, and faking timers
      // wholesale would swallow the promises this test awaits.
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const mock = failing();
        for (let i = 0; i < 4; i += 1) await isBreachedPassword(PASSWORD);
        expect(mock).toHaveBeenCalledTimes(3);

        vi.setSystemTime(Date.now() + 60_001);
        await isBreachedPassword(PASSWORD);

        // An outage that ends must not leave the check off until a restart.
        expect(mock).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it('resumes reporting breaches when the service comes back', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        failing();
        for (let i = 0; i < 3; i += 1) await isBreachedPassword(PASSWORD);

        vi.setSystemTime(Date.now() + 60_001);
        stubFetch(responding(`${digestOf(PASSWORD).slice(5)}:1874`));

        expect(await isBreachedPassword(PASSWORD)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
