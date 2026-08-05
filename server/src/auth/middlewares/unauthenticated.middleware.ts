import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/jwt.service';
import { isAccessTokenBlacklisted } from '../services/token.service';

/**
 * Blocks login and registration for callers who already have a session.
 *
 * It used to reject on the mere *presence* of an accessToken cookie. A stale
 * one — expired, revoked, or left behind by a logout that failed — therefore
 * locked the user out of `/auth/login` with a 403 and no way back except
 * clearing cookies by hand. A cookie that does not represent a live session is
 * treated as no session at all.
 */
export const unauthenticatedGuard = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = req.cookies?.accessToken;

  if (!token) {
    next();
    return;
  }

  try {
    verifyAccessToken(token);

    if (await isAccessTokenBlacklisted(token)) {
      next();
      return;
    }

    res.status(403).json({
      error: 'You are already signed in.',
      code: 'ALREADY_AUTHENTICATED',
    });
  } catch {
    // Not a usable session — let them sign in again.
    next();
  }
};
