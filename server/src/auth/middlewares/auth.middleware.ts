import { Request, Response, NextFunction } from 'express';
import { TokenPayload } from '../../auth/services/jwt.service';
import jwt from 'jsonwebtoken';
import config from '../../config/config';

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Get token from header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authorization token not found' });
    return;
  }

  // Verify token
  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ message: 'Invalid or expired token' });
    return;
  }
  try {
    // Use try-catch to handle JWT verification errors
    const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload;
    req.user = decoded;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next();
    } else {
      // Handle other JWT errors
      res.status(401).json({ message: 'Unauthorized: Invalid token' });
      return;
    }
  }
};

export const authorize = () => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    next();
  };
};
