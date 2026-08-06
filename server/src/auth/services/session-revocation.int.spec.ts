import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RedisClientType } from 'redis';
import { describeRedisIntegration, openTestRedis } from '../../test/env';
import { connectRedis, redisClient, redisSubscriber } from '../../config/redis';
import config from '../../config/config';
import {
  REVOCATION_TTL,
  durationToSeconds,
  isSessionRevoked,
  revokeSessionsBefore,
} from './token.service';

/*
 * "Sign out everywhere", for the sessions the server cannot name.
 *
 * Deleting a user's refresh tokens stops them renewing, and blacklisting an
 * access token stops that one token. Neither reaches the access tokens already
 * sitting in other browsers: they are self-contained JWTs the server has never
 * seen and cannot enumerate, and they stay valid until they expire — an hour by
 * default. On an account signed out *because* it was compromised, that is the
 * hour that matters.
 *
 * So revocation is recorded as a moment rather than a list, and every access
 * token is checked against it by the `iat` it already carries.
 *
 * Run against real Redis: the whole mechanism is one key, its TTL and a
 * comparison, and a fake would be asserting the comparison against itself.
 */

const secondsAgo = (n: number) => Math.floor(Date.now() / 1000) - n;

describeRedisIntegration('session revocation', () => {
  let redis: RedisClientType;

  const USER = 'user-revocation-test';
  const key = `revoked:{${USER}}`;

  beforeAll(async () => {
    // The service under test writes through the shared client, not through a
    // handle a test can pass in — so that one has to be connected rather than
    // stood in for. `redis` below is a second client, used only to inspect the
    // key and its TTL from the outside.
    await connectRedis();
    redis = await openTestRedis();
  });

  afterEach(async () => {
    await redis.del(key);
  });

  afterAll(async () => {
    await redis.quit();
    await Promise.all([redisClient.quit(), redisSubscriber.quit()]);
  });

  it('allows everything when nothing has been revoked', async () => {
    expect(
      await isSessionRevoked({ userId: USER, iat: secondsAgo(5) }),
    ).toBe(false);
  });

  it('refuses a token issued before the revocation', async () => {
    // The one that matters: a token in another browser, which the server has
    // no other way to reach.
    const old = secondsAgo(60);
    await revokeSessionsBefore(USER);

    expect(await isSessionRevoked({ userId: USER, iat: old })).toBe(true);
  });

  it('allows a token issued after it', async () => {
    // Signing in again has to work immediately, or "sign out everywhere" locks
    // the user out of their own account.
    await revokeSessionsBefore(USER);
    await new Promise((r) => setTimeout(r, 1100));

    const fresh = Math.floor(Date.now() / 1000);
    expect(await isSessionRevoked({ userId: USER, iat: fresh })).toBe(false);
  });

  it('allows a token issued in the same second as the revocation', async () => {
    /*
     * The case that made the first version of this unusable, found by the
     * end-to-end smoke test rather than by reasoning.
     *
     * `iat` is whole seconds. Recording the revocation in milliseconds and
     * comparing `iat * 1000` made a token minted moments *after* it look
     * older, so signing in again straight away produced a session that 401'd
     * on its first request — the user is told they are logged in, and then
     * nothing works. Signing out and signing back in is exactly what people do
     * here, so this was not an edge case.
     *
     * Resolved in favour of never refusing a legitimate sign-in: the cost is
     * that a token from earlier in that same second survives, which is under a
     * second of exposure against an attacker who would have had to obtain one
     * inside it.
     */
    await revokeSessionsBefore(USER);
    const sameSecond = Math.floor(Date.now() / 1000);

    expect(
      await isSessionRevoked({ userId: USER, iat: sameSecond }),
    ).toBe(false);
  });

  it('does not touch another user', async () => {
    await revokeSessionsBefore(USER);

    expect(
      await isSessionRevoked({ userId: 'someone-else', iat: secondsAgo(60) }),
    ).toBe(false);
  });

  describe('keeping the caller signed in', () => {
    /*
     * Changing a password invalidates the other devices — most of the point of
     * changing it — but signing the user out of the machine they are typing on
     * turns a routine action into a re-login, which is the friction that stops
     * people rotating a password they think is exposed.
     */

    it('exempts the session that asked', async () => {
      const old = secondsAgo(60);
      await revokeSessionsBefore(USER, 'session-a');

      expect(
        await isSessionRevoked({ userId: USER, iat: old, sid: 'session-a' }),
      ).toBe(false);
    });

    it('still refuses the others', async () => {
      const old = secondsAgo(60);
      await revokeSessionsBefore(USER, 'session-a');

      expect(
        await isSessionRevoked({ userId: USER, iat: old, sid: 'session-b' }),
      ).toBe(true);
      // A token predating sessions carries no sid, and is not the one kept.
      expect(await isSessionRevoked({ userId: USER, iat: old })).toBe(true);
    });

    it('exempts nothing when no session is named', async () => {
      const old = secondsAgo(60);
      await revokeSessionsBefore(USER);

      expect(
        await isSessionRevoked({ userId: USER, iat: old, sid: 'session-a' }),
      ).toBe(true);
    });
  });

  describe('the record itself', () => {
    it('expires on its own', async () => {
      /*
       * It only has to outlive the last access token that predates it — after
       * that every such token has expired anyway and the comparison is moot.
       * Without a TTL this would be one permanent key per user who ever signed
       * out.
       */
      await revokeSessionsBefore(USER);

      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(REVOCATION_TTL);
      // A couple of seconds of tolerance for the round trip, no more: a record
      // that expired early would let a revoked token come back to life.
      expect(ttl).toBeGreaterThan(REVOCATION_TTL - 5);
    });

    it('outlives the access tokens it has to refuse', async () => {
      // The property, rather than a number: shortening JWT_EXPIRES_IN must
      // shorten this with it, and it must never be the shorter of the two.
      const accessTokenLifetime = durationToSeconds(config.jwtExpiresIn, 3600);
      expect(REVOCATION_TTL).toBeGreaterThan(accessTokenLifetime);
    });

    it('a later revocation replaces the earlier one', async () => {
      await revokeSessionsBefore(USER, 'session-a');
      await new Promise((r) => setTimeout(r, 20));
      await revokeSessionsBefore(USER);

      // The exemption from the first call must not survive the second.
      expect(
        await isSessionRevoked({
          userId: USER,
          iat: secondsAgo(60),
          sid: 'session-a',
        }),
      ).toBe(true);
    });
  });

  describe('failure modes', () => {
    it('allows a token that carries no issued-at', async () => {
      // It cannot be placed in time. jsonwebtoken always sets one, so this is
      // a malformed token rather than an old one, and the signature check has
      // already passed on it.
      await revokeSessionsBefore(USER);
      expect(await isSessionRevoked({ userId: USER })).toBe(false);
    });

    it('allows the token when the record is unreadable', async () => {
      /*
       * Fails open, unlike the checks around it, and deliberately: this runs on
       * every authenticated request, so failing closed turns a Redis problem
       * into a total outage that presents as everyone being signed out at once.
       * The refresh tokens are already deleted by then, so the exposure is
       * bounded by one access-token lifetime — the state this feature improves
       * on, not a regression from it.
       */
      await redis.set(key, 'not json');

      expect(
        await isSessionRevoked({ userId: USER, iat: secondsAgo(60) }),
      ).toBe(false);
    });
  });

  it('announces the revocation so open sockets can be closed', async () => {
    /*
     * A socket authorises once, at the handshake. Refusing the next upgrade is
     * not enough — one already open would keep delivering messages to a device
     * that has been signed out, for as long as its token had left.
     */
    const listener = redis.duplicate();
    await listener.connect();

    const received: { userId: string; at: number; keepSid?: string }[] = [];
    await listener.subscribe('ws:revoke', (raw) =>
      received.push(JSON.parse(raw)),
    );

    try {
      await revokeSessionsBefore(USER, 'session-a');
      await new Promise((r) => setTimeout(r, 100));

      expect(received).toHaveLength(1);
      expect(received[0].userId).toBe(USER);
      expect(received[0].keepSid).toBe('session-a');
      // Seconds, matching the `iat` the socket recorded at its handshake.
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(received[0].at).toBeGreaterThan(nowSeconds - 5);
      expect(received[0].at).toBeLessThanOrEqual(nowSeconds);
    } finally {
      await listener.unsubscribe('ws:revoke');
      await listener.quit();
    }
  });
});
