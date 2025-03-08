import jwt from 'jsonwebtoken';
import config from '../config/config';
import { IUser } from '../models/user.model';

export interface TokenPayload {
  userId: string;
  username: string;
  email: string;
  roles: string[];
}

export const generateToken = (user: IUser): string => {
  const payload: TokenPayload = {
    userId: user._id?.toString() || 'no-id',
    username: user.username,
    email: user.email,
    roles: user.roles,
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
};

export const verifyToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch (error) {
    return null;
  }
};
