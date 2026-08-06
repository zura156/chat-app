import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config/config';
import { IConversation } from '../../messenger/models/conversation.model';
import { IUser, User } from '../../user/models/user.model';
import {
  isAccessTokenBlacklisted,
  isSessionRevoked,
} from '../services/token.service';
import { verifyAccessToken } from '../services/jwt.service';

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
    // Type-scoped: a two-factor challenge is signed with the same secret, and
    // accepting one here was a complete bypass of the second factor.
    const decoded = verifyAccessToken(token);
    const blacklisted = await isAccessTokenBlacklisted(token);

    if (blacklisted) {
      res.status(401).json({ error: 'Token revoked' });
      return;
    }

    // The blacklist above only knows tokens the server has held. "Sign out
    // everywhere" has to refuse the ones sitting in other browsers, which it
    // has never seen — so those are refused by age instead.
    if (await isSessionRevoked(decoded)) {
      res.status(401).json({ error: 'Session revoked' });
      return;
    }

    // `is_email_verified` is selected because requireVerifiedEmail runs after
    // this and has nothing else to read it from.
    const user = await User.findById(decoded.userId).select(
      '-password -refreshTokens -login_attempts -lock_until -last_login',
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

/**
 * Gates the app behind a verified address. The whole verification flow existed
 * — token model, mail, endpoint, a flag on the user — but nothing ever read the
 * flag, so the emails were decorative and any address could be used.
 *
 * Deliberately not applied to the routes the user needs *in order to* verify,
 * or to the ones that let them leave: reading their own profile, listing and
 * revoking sessions, and logging out all stay open, so an unverified account is
 * inconvenienced rather than trapped.
 */
export const requireVerifiedEmail = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  // Opt-in: enforcing this against a user base that predates it locks everyone
  // out at once. See config.requireEmailVerification.
  if (!config.requireEmailVerification) {
    next();
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  if (!req.user.is_email_verified) {
    res.status(403).json({
      error: 'Verify your email address to continue',
      code: 'EMAIL_NOT_VERIFIED',
    });
    return;
  }

  next();
};
