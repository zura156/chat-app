import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export const csrfTokens = new Map();

export const generateCSRFToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

export const validateCSRF = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.method === 'GET') {
    next();
    return;
  }
  const token = req.headers['x-csrf-token'] as string;
  const sessionId = req.cookies.sessionId;

  if (!token || !sessionId || csrfTokens.get(sessionId) !== token) {
    res.status(403).json({ error: 'Invalid CSRF token' });
    return;
  }

  next();
};
