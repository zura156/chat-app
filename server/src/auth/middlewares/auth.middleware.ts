import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config/config';
import { IConversation } from '../../messenger/models/conversation.model';
import { IUser, User } from '../../user/models/user.model';
import { isAccessTokenBlacklisted } from '../services/token.service';

export interface AuthRequest extends Request {
  user?: IUser;
  conversation?: IConversation;
  /** The session this access token belongs to — see TokenPayload.sid. */
  sessionId?: string;
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = req.cookies.accessToken;

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      sid?: string;
    };
    const blacklisted = await isAccessTokenBlacklisted(token);

    if (blacklisted) {
      res.status(401).json({ error: 'Token revoked' });
      return;
    }

    const user = await User.findById(decoded.userId).select(
      '-password -refreshTokens -is_email_verified -login_attempts -lock_until -last_login',
    );

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = user;
    req.sessionId = decoded.sid;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }
    res.status(403).json({ error: 'Invalid token' });
    return;
  }
};
