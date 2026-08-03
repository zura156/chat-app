import jwt from 'jsonwebtoken';
import config from '../../config/config';

export interface TokenPayload {
  userId: string;
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
  const payload = sid ? { userId, sid } : { userId };

  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as any,
  });
  const refreshToken = jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshTokenExpiresIn as any,
  });
  return { accessToken, refreshToken };
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, config.jwtSecret) as TokenPayload;
};
