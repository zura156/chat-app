import { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  user?: any;
}

export const isAuthenticated = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (req.session && req.session.id) {
    return next();
  }
  res.status(401).json({ message: 'Unauthorized: Please log in' });
};
