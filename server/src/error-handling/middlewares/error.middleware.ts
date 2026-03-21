import { Request, Response, NextFunction } from 'express';
import { CustomAPIError } from '../models/custom-api-error.model';

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof CustomAPIError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid ID format' });
  }

  // Mongoose duplicate key
  if ((err as any).code === 11000) {
    const field = Object.keys((err as any).keyValue ?? {})[0];
    return res.status(409).json({ message: `${field} already exists` });
  }

  console.error(err); // log full error server-side only

  return res.status(500).json({
    message: 'Something went wrong! Please try again later...',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
};
