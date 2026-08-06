import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import config from '../../config/config';
import {
  generateTokens,
  generateTwoFactorChallenge,
  verifyAccessToken,
  verifyRefreshToken,
  verifyTwoFactorChallenge,
} from './jwt.service';

/*
 * The `typ` claim is the only thing standing between a two-factor challenge and
 * an access token: both are signed with `jwtSecret`, so without it one is
 * verifiable as the other and a password alone gets you a session. That is a
 * complete bypass of the second factor, and it is invisible in review — the
 * code reads as "verify the token", and it does.
 *
 * These tests exist so that removing or defaulting `typ` fails loudly.
 */

const USER_ID = '507f1f77bcf86cd799439011';

describe('token typing', () => {
  it('accepts an access token as an access token', () => {
    const { accessToken } = generateTokens(USER_ID);
    expect(verifyAccessToken(accessToken).userId).toBe(USER_ID);
  });

  it('refuses a two-factor challenge as an access token', () => {
    // The bypass. If this ever passes, anyone holding only a password can skip
    // the second factor by presenting the challenge cookie as `accessToken`.
    const challenge = generateTwoFactorChallenge(USER_ID);
    expect(() => verifyAccessToken(challenge)).toThrow(jwt.JsonWebTokenError);
  });

  it('refuses an access token as a two-factor challenge', () => {
    const { accessToken } = generateTokens(USER_ID);
    expect(() => verifyTwoFactorChallenge(accessToken)).toThrow(
      jwt.JsonWebTokenError,
    );
  });

  it('refuses an access token as a refresh token, and vice versa', () => {
    const { accessToken, refreshToken } = generateTokens(USER_ID);
    expect(() => verifyRefreshToken(accessToken)).toThrow();
    expect(() => verifyAccessToken(refreshToken)).toThrow();
  });

  it('refuses an untyped token, rather than treating it as an access token', () => {
    // Tokens minted before `typ` existed. Treating "no type" as "access" is the
    // tempting migration and it reopens the bypass for the lifetime of every
    // token already in the wild.
    const legacy = jwt.sign({ userId: USER_ID }, config.jwtSecret, {
      expiresIn: '1h',
    });
    expect(() => verifyAccessToken(legacy)).toThrow(jwt.JsonWebTokenError);
  });

  it('refuses a token typed by an attacker but signed with the wrong secret', () => {
    const forged = jwt.sign(
      { userId: USER_ID, typ: 'access' },
      'not-the-real-secret',
      { expiresIn: '1h' },
    );
    expect(() => verifyAccessToken(forged)).toThrow();
  });
});

describe('sessions', () => {
  it('carries the session id on both halves of a pair', () => {
    // The refresh cookie is scoped to /auth/refresh, so `sid` in the token is
    // the only way any other endpoint can tell which session is the caller's.
    const sid = 'a'.repeat(32);
    const { accessToken, refreshToken } = generateTokens(USER_ID, sid);

    expect(verifyAccessToken(accessToken).sid).toBe(sid);
    expect(verifyRefreshToken(refreshToken).sid).toBe(sid);
  });

  it('omits sid entirely when none is given', () => {
    const { accessToken } = generateTokens(USER_ID);
    expect(verifyAccessToken(accessToken).sid).toBeUndefined();
  });
});

describe('expiry', () => {
  const expiredAccessToken = () =>
    jwt.sign({ userId: USER_ID, typ: 'access' }, config.jwtSecret, {
      expiresIn: -10,
    });

  it('rejects an expired access token by default', () => {
    expect(() => verifyAccessToken(expiredAccessToken())).toThrow(
      jwt.TokenExpiredError,
    );
  });

  it('reads an expired token only when the caller opts in', () => {
    /*
     * `ignoreExpiration` has exactly one legitimate caller: rate-limit keying,
     * which needs to recognise the account behind the token on /auth/refresh —
     * where the access token has just expired by definition — without
     * authorising anything on the strength of it. The signature is still
     * checked, so the id cannot be forged.
     */
    const decoded = verifyAccessToken(expiredAccessToken(), {
      ignoreExpiration: true,
    });
    expect(decoded.userId).toBe(USER_ID);
  });

  it('still enforces the type when ignoring expiration', () => {
    const challenge = jwt.sign(
      { userId: USER_ID, typ: 'two-factor-challenge' },
      config.jwtSecret,
      { expiresIn: -10 },
    );
    expect(() =>
      verifyAccessToken(challenge, { ignoreExpiration: true }),
    ).toThrow(jwt.JsonWebTokenError);
  });
});
