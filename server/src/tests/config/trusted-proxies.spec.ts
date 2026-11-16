import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * `TRUSTED_PROXIES` goes straight into `app.set('trust proxy', ...)`, and
 * Express compiles that list on the spot: one entry it cannot read as an
 * address, a range or a keyword (`loopback`, `uniquelocal`, ...) throws
 * "invalid IP address" and the server never boots.
 *
 * The parsing used to be a bare `split(',')`, so two ordinary ways of writing
 * the variable produced exactly that entry: a blank `TRUSTED_PROXIES=` gave
 * `['']`, and a space after a comma gave `[' uniquelocal']`. Both are what a
 * person editing a `.env` by hand writes. The last case below runs the parsed
 * value through Express itself, because that is where the crash happened.
 *
 * `config` reads the environment once, at import, so each case resets the
 * module registry and imports it again (same pattern as bcrypt-rounds.spec).
 *
 * `config.ts` also calls `dotenv.config()` on import, which refills a deleted
 * variable from the developer's `server/.env` — so "unset" would mean "whatever
 * that file says" and the case would pass or fail per machine. dotenv is
 * stubbed out so the environment each case sets is the whole environment.
 */
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const loadConfig = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    // Assigning `undefined` to process.env stores the string "undefined".
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (await import('../../config/config')).default;
};

describe('trustedProxies', () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = {
      TRUSTED_PROXIES: process.env.TRUSTED_PROXIES,
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

  it('trusts nothing when the variable is unset', async () => {
    const config = await loadConfig({
      TRUSTED_PROXIES: undefined,
      NODE_ENV: 'test',
    });
    expect(config.trustedProxies).toEqual([]);
  });

  it('trusts nothing when the variable is blank or only whitespace', async () => {
    for (const value of ['', '   ']) {
      const config = await loadConfig({
        TRUSTED_PROXIES: value,
        NODE_ENV: 'test',
      });
      expect(config.trustedProxies).toEqual([]);
    }
  });

  it('trims the space people put after a comma', async () => {
    const config = await loadConfig({
      TRUSTED_PROXIES: 'loopback, uniquelocal',
      NODE_ENV: 'test',
    });
    expect(config.trustedProxies).toEqual(['loopback', 'uniquelocal']);
  });

  it('drops empty entries from doubled and trailing commas', async () => {
    const config = await loadConfig({
      TRUSTED_PROXIES: '10.0.0.0/8,,172.16.0.0/12,',
      NODE_ENV: 'test',
    });
    expect(config.trustedProxies).toEqual(['10.0.0.0/8', '172.16.0.0/12']);
  });

  it('produces a list Express accepts, for every input above', async () => {
    for (const value of [
      undefined,
      '',
      '   ',
      'loopback, uniquelocal',
      '10.0.0.0/8,,172.16.0.0/12,',
    ]) {
      const config = await loadConfig({
        TRUSTED_PROXIES: value,
        NODE_ENV: 'test',
      });
      expect(() =>
        express().set('trust proxy', config.trustedProxies),
      ).not.toThrow();
    }
  });
});
