import { Request, Response, NextFunction } from 'express';
import { CustomAPIError } from '../models/custom-api-error.model';

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof CustomAPIError) {
    return res.status(err.statusCode).json({ message: err.message });
  }
  return res
    .status(500)
    .json({ message: 'Something went wrong! Please try again later...' });
};
