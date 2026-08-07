import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The bcrypt work factor, which exists as a setting for exactly one reason: the
 * test suite creates users constantly and a full-cost hash each time is seconds
 * per run. That is a convenience, and it is buying it with the number that
 * protects a stolen password table — so the guard that keeps it from following
 * the code into production is the part worth testing.
 *
 * `config` reads the environment once, at import, so each case has to reset the
 * module registry and import it again rather than mutate an already-built
 * object.
 */
const loadConfig = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (await import('./config')).default;
};

describe('bcryptRounds', () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = {
      BCRYPT_ROUNDS: process.env.BCRYPT_ROUNDS,
      NODE_ENV: process.env.NODE_ENV,
    };
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it('defaults to 10 when nothing sets it', async () => {
    const config = await loadConfig({
      BCRYPT_ROUNDS: undefined,
      NODE_ENV: 'development',
    });
    expect(config.bcryptRounds).toBe(10);
  });

  it('takes a cheaper factor outside production', async () => {
    // What the test setup relies on.
    const config = await loadConfig({
      BCRYPT_ROUNDS: '4',
      NODE_ENV: 'test',
    });
    expect(config.bcryptRounds).toBe(4);
  });

  it('refuses to go below 10 in production', async () => {
    /*
     * The failure this exists for: `BCRYPT_ROUNDS=4` reaching a deployed
     * environment — leaked from a compose file, a CI export, or a copied
     * `.env` — and silently rehashing every new password at a factor chosen to
     * make tests fast. Nothing would fail, and nothing would look wrong.
     */
    const config = await loadConfig({
      BCRYPT_ROUNDS: '4',
      NODE_ENV: 'production',
    });
    expect(config.bcryptRounds).toBe(10);
  });

  it('still allows raising the factor in production', async () => {
    const config = await loadConfig({
      BCRYPT_ROUNDS: '12',
      NODE_ENV: 'production',
    });
    expect(config.bcryptRounds).toBe(12);
  });

  it('falls back to 10 on nonsense rather than to bcrypt throwing', async () => {
    for (const value of ['', 'abc', '0', '-1', '99']) {
      const config = await loadConfig({
        BCRYPT_ROUNDS: value,
        NODE_ENV: 'development',
      });
      expect(config.bcryptRounds).toBe(10);
    }
  });
});
