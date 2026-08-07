import type { NextFunction, Request, Response } from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RedisClientType } from 'redis';
import { describeRedisIntegration, openTestRedis } from '../test/env';
import { connectRedis, redisClient, redisSubscriber } from '../config/redis';
import { generateTokens } from './services/jwt.service';
import {
  markSessionRevoked,
  revokeSessionsBefore,
  storeRefreshToken,
} from './services/token.service';
import { refreshAccessToken } from './auth.controller';

/*
 * Renewal, against a session that has been revoked.
 *
 * Every path that ends a session also deletes its refresh tokens, so the entry
 * is normally gone and renewal fails on that alone. This covers the case where
 * it is not — a process dying between the two halves is the likely way — and
 * the state it leaves is the one that matters: renewal mints a *fresh* access
 * token, which the revocation epoch cannot refuse because it is newer than the
 * revocation. A revoked session would renew its way back to life.
 *
 * The handler is called directly rather than over HTTP. It touches no database
 * and nothing but the cookies on the request, so a real socket and a real
 * Mongo would only be scenery; Redis is real because the revocation records
 * are the thing under test.
 */

interface Reply {
  status: number;
  body: any;
  cleared: string[];
  cookies: string[];
}

const call = async (refreshToken: string): Promise<Reply> => {
  const reply: Reply = { status: 200, body: undefined, cleared: [], cookies: [] };

  const req = {
    cookies: { refreshToken },
    headers: { 'user-agent': 'refresh-revocation-spec' },
    ip: '127.0.0.1',
  } as unknown as Request;

  const res = {
    status(code: number) {
      reply.status = code;
      return this;
    },
    json(body: unknown) {
      reply.body = body;
      return this;
    },
    cookie(name: string) {
      reply.cookies.push(name);
      return this;
    },
    clearCookie(name: string) {
      reply.cleared.push(name);
      return this;
    },
  } as unknown as Response;

  // A handler that reached `next` would be reporting a fault, which is itself a
  // failure here: an expired or revoked session is routine and must answer 401.
  const next = ((err?: unknown) => {
    throw err ?? new Error('refreshAccessToken deferred to the error handler');
  }) as NextFunction;

  await refreshAccessToken(req, res, next);
  return reply;
};

describeRedisIntegration('renewing a revoked session', () => {
  let redis: RedisClientType;

  const USER = 'user-refresh-revocation-test';
  const SID = 'session-under-test';

  /** A live session, as a login would leave it: a real token and its entry. */
  const signIn = async (sid = SID): Promise<string> => {
    const { refreshToken } = generateTokens(USER, sid);
    await storeRefreshToken(USER, refreshToken, { sid });
    return refreshToken;
  };

  beforeAll(async () => {
    await connectRedis();
    redis = await openTestRedis();
  });

  afterEach(async () => {
    const keys = await redis.keys(`*{${USER}}*`);
    if (keys.length) await redis.del(keys);
  });

  afterAll(async () => {
    await redis.quit();
    await Promise.all([redisClient.quit(), redisSubscriber.quit()]);
  });

  it('renews a session nothing has revoked', async () => {
    // The control. Without it the assertions below pass just as well against a
    // handler that refuses everything.
    const reply = await call(await signIn());

    expect(reply.status).toBe(200);
    expect(reply.cookies).toContain('accessToken');
    expect(reply.cookies).toContain('refreshToken');
  });

  it('refuses one whose session was ended by name', async () => {
    const refreshToken = await signIn();
    // Deliberately without deleting the entry: that is the state being tested,
    // and `revokeSession` would remove it.
    await markSessionRevoked(USER, SID);

    const reply = await call(refreshToken);

    expect(reply.status).toBe(401);
    expect(reply.body).toEqual({ message: 'Session revoked' });
    // The session is over, so the cookies go with it — otherwise the client
    // retries against a session that will never come back.
    expect(reply.cleared).toContain('refreshToken');
    expect(reply.cookies).not.toContain('accessToken');
  });

  it('refuses one that predates a sign-out-everywhere', async () => {
    // A second has to pass first: the epoch is recorded in whole seconds, and a
    // token minted within the same one is deliberately allowed. See the note on
    // `Revocation` in token.service.
    const refreshToken = await signIn();
    await new Promise((r) => setTimeout(r, 1100));
    await revokeSessionsBefore(USER);

    const reply = await call(refreshToken);

    expect(reply.status).toBe(401);
    expect(reply.body).toEqual({ message: 'Session revoked' });
  });

  it('still renews the session a password change kept', async () => {
    /*
     * The regression this check could easily have caused.
     *
     * A password change revokes everything *except* the device doing the
     * changing, and that device's refresh token was issued at login — before
     * the revocation. Comparing timestamps alone would refuse it, so the user
     * keeps their session for one access-token lifetime and is then silently
     * signed out of the machine they changed their password on.
     */
    const refreshToken = await signIn();
    await new Promise((r) => setTimeout(r, 1100));
    await revokeSessionsBefore(USER, SID);

    const reply = await call(refreshToken);

    expect(reply.status).toBe(200);
    expect(reply.cookies).toContain('accessToken');
  });

  it('refuses the other devices that change signed out', async () => {
    // The same revocation, from a session it did not exempt.
    const refreshToken = await signIn('another-session');
    await new Promise((r) => setTimeout(r, 1100));
    await revokeSessionsBefore(USER, SID);

    const reply = await call(refreshToken);

    expect(reply.status).toBe(401);
  });
});
