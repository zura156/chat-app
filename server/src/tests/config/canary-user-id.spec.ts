import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * `CANARY_USER_ID` names the one account whose finished uploads the worker
 * deletes every hour (sentinel's upload canary, Z ADR 0031). The sweep hands
 * this value to a delete, so anything that is not plainly an ObjectId turns it
 * off instead of reaching a filter: Mongoose's own `isValid` would accept any
 * twelve-character string.
 *
 * Same pattern as trusted-proxies.spec: dotenv is stubbed so the environment
 * each case sets is the whole environment.
 */
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const loadConfig = async (value: string | undefined) => {
  vi.resetModules();
  if (value === undefined) delete process.env.CANARY_USER_ID;
  else process.env.CANARY_USER_ID = value;
  return (await import('../../config/config')).default;
};

describe('canaryUserId', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.CANARY_USER_ID;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CANARY_USER_ID;
    else process.env.CANARY_USER_ID = original;
    vi.resetModules();
  });

  it('is off when the variable is unset or blank', async () => {
    for (const value of [undefined, '', '   ']) {
      expect((await loadConfig(value)).canaryUserId).toBe('');
    }
  });

  it('takes a 24-hex ObjectId, trimmed and lowercased', async () => {
    const config = await loadConfig('  65F1C0FFEE0123456789ABCD \n');
    expect(config.canaryUserId).toBe('65f1c0ffee0123456789abcd');
  });

  it('is off for anything else, twelve-character strings included', async () => {
    for (const value of ['aaaaaaaaaaaa', 'canary@example.test', '65f1c0ffee0123456789abc', 'undefined']) {
      expect((await loadConfig(value)).canaryUserId).toBe('');
    }
  });
});
