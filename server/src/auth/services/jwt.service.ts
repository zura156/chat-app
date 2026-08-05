import jwt from 'jsonwebtoken';
import config from '../../config/config';

/**
 * Every token this service mints carries what it is for. Without it, any token
 * signed with `jwtSecret` is interchangeable with any other — which is how the
 * short-lived two-factor challenge (also signed with `jwtSecret`) was accepted
 * as an access token, letting anyone holding only a password skip the second
 * factor entirely.
 *
 * Verification is always type-scoped: `verifyAccessToken` rejects anything that
 * is not an access token, and a token minted before this field existed has no
 * `typ` and is rejected too. That last part is deliberate — the alternative is
 * treating "no type" as "access", which reopens the hole for the lifetime of
 * every token already in the wild.
 */
export type TokenType = 'access' | 'refresh' | 'two-factor-challenge';

export interface TokenPayload {
  userId: string;
  /** What this token authorises. See the note above. */
  typ: TokenType;
  /**
   * The session this token belongs to, stable across refresh-token rotation.
   * Carried in the token because the refresh cookie is scoped to
   * `/auth/refresh` and so is invisible to any other endpoint — including the
   * one that lists sessions and needs to know which is the caller's own.
   */
  sid?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  email?: string;
  iat?: number;
  exp?: number;
}

export const generateTokens = (userId: string, sid?: string) => {
  const base = sid ? { userId, sid } : { userId };

  const accessToken = jwt.sign(
    { ...base, typ: 'access' satisfies TokenType },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as any },
  );
  const refreshToken = jwt.sign(
    { ...base, typ: 'refresh' satisfies TokenType },
    config.jwtRefreshSecret,
    { expiresIn: config.jwtRefreshTokenExpiresIn as any },
  );
  return { accessToken, refreshToken };
};

/** The short-lived token that stands between a password and a second factor. */
export const generateTwoFactorChallenge = (userId: string): string =>
  jwt.sign(
    { userId, typ: 'two-factor-challenge' satisfies TokenType },
    config.jwtSecret,
    { expiresIn: '5m' },
  );

const verifyTyped = (
  token: string,
  secret: string,
  expected: TokenType,
  options?: jwt.VerifyOptions,
): TokenPayload => {
  const decoded = jwt.verify(token, secret, options) as TokenPayload;

  if (decoded?.typ !== expected) {
    throw new jwt.JsonWebTokenError(
      `Expected a ${expected} token, got ${decoded?.typ ?? 'an untyped token'}`,
    );
  }

  return decoded;
};

/**
 * `options` exists for one caller: rate-limit keying, which passes
 * `ignoreExpiration` because it needs to recognise the account behind an
 * expired token without authorising anything on the strength of it. Anything
 * that grants access must call this with no options.
 */
export const verifyAccessToken = (
  token: string,
  options?: jwt.VerifyOptions,
): TokenPayload => verifyTyped(token, config.jwtSecret, 'access', options);

export const verifyRefreshToken = (token: string): TokenPayload =>
  verifyTyped(token, config.jwtRefreshSecret, 'refresh');

export const verifyTwoFactorChallenge = (token: string): TokenPayload =>
  verifyTyped(token, config.jwtSecret, 'two-factor-challenge');
