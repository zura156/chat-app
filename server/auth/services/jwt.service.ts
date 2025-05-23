import jwt from 'jsonwebtoken';
import config from '../../config/config';
import { IUser } from '../../user/models/user.model';

export interface TokenPayload {
  userId: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  email?: string;
  iat?: number;
  exp?: number;
}

export const generateTokens = (user: IUser) => {
  const payload: TokenPayload = {
    userId: user._id?.toString() || 'no-id',
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    email: user.email,
  };

  const refreshTokenPayload: TokenPayload = {
    userId: payload.userId,
  };

  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });

  const refreshToken = jwt.sign(refreshTokenPayload, config.jwtSecret, {
    expiresIn: config.jwtRefreshTokenExpiresIn as jwt.SignOptions['expiresIn'],
  });

  return { accessToken, refreshToken };
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, config.jwtSecret) as TokenPayload;
};
