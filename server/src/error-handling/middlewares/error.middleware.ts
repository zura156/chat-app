import { Request, Response, NextFunction } from 'express';
import { CustomAPIError } from '../models/custom-api-error.model';
import { logger } from '../../utils/logger';

/** Human labels for the paths Mongoose reports, which are raw schema keys. */
const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  username: 'Username',
  first_name: 'First name',
  last_name: 'Last name',
  password: 'Password',
  bio: 'Bio',
  group_name: 'Group name',
  content: 'Message',
};

const labelFor = (field: string): string =>
  FIELD_LABELS[field] ?? field.replace(/_/g, ' ');

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof CustomAPIError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  /*
   * Mongoose validation error.
   *
   * `err.message` is the aggregated internal form — "User validation failed:
   * username: Path `username` is required." — which names the model, repeats
   * the path twice and backticks a schema key. It was going straight to the
   * user. The per-path messages underneath it are the ones the schema actually
   * authored, so those are used and the wrapper is dropped.
   */
  if (err.name === 'ValidationError') {
    const paths = (err as any).errors ?? {};
    const details = Object.keys(paths).map((path) => ({
      field: path,
      msg: String(paths[path]?.message ?? 'is not valid'),
    }));

    return res.status(400).json({
      message: details.length
        ? details
            .map((detail) =>
              detail.msg.toLowerCase().includes(detail.field.toLowerCase())
                ? detail.msg
                : `${labelFor(detail.field)}: ${detail.msg}`,
            )
            .join(' ')
        : err.message,
      code: 'VALIDATION_FAILED',
      errors: details,
    });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid ID format' });
  }

  // Mongoose duplicate key
  if ((err as any).code === 11000) {
    const field = Object.keys((err as any).keyValue ?? {})[0];
    return res.status(409).json({
      message: field
        ? `That ${labelFor(field).toLowerCase()} is already taken.`
        : 'That value is already taken.',
      code: 'DUPLICATE',
      ...(field && { errors: [{ field, msg: 'is already taken' }] }),
    });
  }

  // logger, not console: the console transport is not the one that persists,
  // so unexpected 500s were the only errors never reaching the error log.
  logger.error('Unhandled request error', {
    method: req.method,
    path: req.originalUrl,
    error: err,
  });

  return res.status(500).json({
    message: 'Something went wrong! Please try again later...',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
};
