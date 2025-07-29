import jwt from 'jsonwebtoken';
import config from '../../config/config';

export interface TokenPayload {
  userId: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  email?: string;
  iat?: number;
  exp?: number;
}

export const generateTokens = (userId: string) => {
  const accessToken = jwt.sign({ userId }, config.jwtSecret, {
    expiresIn: '15m',
  });
  const refreshToken = jwt.sign({ userId }, config.jwtRefreshSecret, {
    expiresIn: '7d',
  });
  return { accessToken, refreshToken };
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, config.jwtSecret) as TokenPayload;
};
