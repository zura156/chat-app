import { Request, Response, NextFunction } from 'express';
import { csrfTokens } from '../services/csrf.service';

export const validateCSRF = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const methodsToProtect = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (!methodsToProtect.includes(req.method)) {
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
