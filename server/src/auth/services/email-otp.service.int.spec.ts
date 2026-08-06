import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RedisClientType } from 'redis';
import { describeRedisIntegration, openTestRedis } from '../../test/env';
import { connectRedis, redisClient, redisSubscriber } from '../../config/redis';
import {
  clearEmailCode,
  issueEmailCode,
  verifyAndConsumeEmailCode,
} from './email-otp.service';

/*
 * Run against real Redis. The whole service is SET/GET/DEL with TTLs and an
 * INCR — a fake would be asserting the mock's behaviour, and the properties
 * worth testing (single use, the send throttle, the attempt cap, and that a
 * fresh code clears the tally) are all about how those commands interact.
 */

const USER = 'user-email-otp-test';

describeRedisIntegration('email one-time codes', () => {
  let redis: RedisClientType;

  beforeAll(async () => {
    await connectRedis();
    redis = await openTestRedis();
  });

  afterEach(async () => {
    await clearEmailCode(USER, 'login');
    await clearEmailCode(USER, 'enroll');
  });

  afterAll(async () => {
    await redis.quit();
    await Promise.all([redisClient.quit(), redisSubscriber.quit()]);
  });

  it('issues a six-digit code', async () => {
    const issued = await issueEmailCode(USER, 'login');
    expect(issued?.code).toMatch(/^\d{6}$/);
  });

  it('accepts the code it just issued', async () => {
    const issued = await issueEmailCode(USER, 'login');
    expect(await verifyAndConsumeEmailCode(USER, 'login', issued!.code)).toBe(
      true,
    );
  });

  it('never stores the code in the clear', async () => {
    const issued = await issueEmailCode(USER, 'login');
    const stored = await redis.get(`2fa:email:code:login:${USER}`);

    expect(stored).toBeTruthy();
    expect(stored).not.toBe(issued!.code);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses the same code twice', async () => {
    const issued = await issueEmailCode(USER, 'login');

    expect(await verifyAndConsumeEmailCode(USER, 'login', issued!.code)).toBe(
      true,
    );
    // The point of "one-time". An observed code — a forwarded mail, a synced
    // inbox on a shared machine — must not still be worth anything.
    expect(await verifyAndConsumeEmailCode(USER, 'login', issued!.code)).toBe(
      false,
    );
  });

  it('refuses a wrong code', async () => {
    const issued = await issueEmailCode(USER, 'login');
    const wrong = issued!.code === '000000' ? '111111' : '000000';

    expect(await verifyAndConsumeEmailCode(USER, 'login', wrong)).toBe(false);
  });

  it('refuses anything that is not six digits without touching the code', async () => {
    const issued = await issueEmailCode(USER, 'login');

    for (const junk of ['', '12345', '1234567', 'abcdef', '12 34 56 78']) {
      expect(await verifyAndConsumeEmailCode(USER, 'login', junk)).toBe(false);
    }

    // Malformed input must not have burned the attempt budget.
    expect(await verifyAndConsumeEmailCode(USER, 'login', issued!.code)).toBe(
      true,
    );
  });

  it('ignores whitespace inside a code', async () => {
    const issued = await issueEmailCode(USER, 'login');
    const spaced = issued!.code.split('').join(' ');

    expect(await verifyAndConsumeEmailCode(USER, 'login', spaced)).toBe(true);
  });

  it('refuses when nothing was ever issued', async () => {
    expect(await verifyAndConsumeEmailCode(USER, 'login', '123456')).toBe(false);
  });

  it('does not let a login code be used to enrol, or the reverse', async () => {
    const issued = await issueEmailCode(USER, 'login');

    // Different purposes are different secrets. Otherwise a code mailed for one
    // step authorises the other.
    expect(await verifyAndConsumeEmailCode(USER, 'enroll', issued!.code)).toBe(
      false,
    );
    expect(await verifyAndConsumeEmailCode(USER, 'login', issued!.code)).toBe(
      true,
    );
  });

  it('throttles a second send', async () => {
    expect(await issueEmailCode(USER, 'login')).not.toBeNull();
    // A stuck client retrying in a loop should not fill the user's inbox.
    expect(await issueEmailCode(USER, 'login')).toBeNull();
  });

  it('throttles each purpose separately', async () => {
    expect(await issueEmailCode(USER, 'login')).not.toBeNull();
    expect(await issueEmailCode(USER, 'enroll')).not.toBeNull();
  });

  it('gives up on a code after too many guesses', async () => {
    const issued = await issueEmailCode(USER, 'login');
    const wrong = issued!.code === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await verifyAndConsumeEmailCode(USER, 'login', wrong)).toBe(false);
    }

    // Worked over too hard to still be trusted — even the right answer is now
    // refused, so a fresh send is the only way forward.
    expect(await verifyAndConsumeEmailCode(USER, 'login', issued!.code)).toBe(
      false,
    );
  });

  it('expires the code, and the throttle outlives neither', async () => {
    await issueEmailCode(USER, 'login');

    const codeTtl = await redis.ttl(`2fa:email:code:login:${USER}`);
    const sendTtl = await redis.ttl(`2fa:email:sent:login:${USER}`);

    expect(codeTtl).toBeGreaterThan(0);
    expect(codeTtl).toBeLessThanOrEqual(10 * 60);
    expect(sendTtl).toBeGreaterThan(0);
    expect(sendTtl).toBeLessThanOrEqual(60);
  });

  it('clears everything when a factor is torn down', async () => {
    const issued = await issueEmailCode(USER, 'login');
    await clearEmailCode(USER, 'login');

    expect(await verifyAndConsumeEmailCode(USER, 'login', issued!.code)).toBe(
      false,
    );
    // And the throttle is gone with it, so re-enrolling can send immediately.
    expect(await issueEmailCode(USER, 'login')).not.toBeNull();
  });

  it('lets a fresh code start with a clean attempt tally', async () => {
    const first = await issueEmailCode(USER, 'login');
    const wrong = first!.code === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 4; attempt++) {
      await verifyAndConsumeEmailCode(USER, 'login', wrong);
    }

    // A resend replaces the code outright, so tries spent against the old one
    // are not tries against this one.
    await clearEmailCode(USER, 'login');
    const second = await issueEmailCode(USER, 'login');

    expect(await verifyAndConsumeEmailCode(USER, 'login', second!.code)).toBe(
      true,
    );
  });
});
