import { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';

/**
 * express-validator chains only *record* errors — without this middleware the
 * validators on the routes are inert and bad input falls through to Mongoose,
 * surfacing as a 500 instead of a 400.
 */
export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(400).json({
      message: 'Validation failed',
      errors: errors.array().map((e) => ({
        msg: e.msg,
        field: e.type === 'field' ? e.path : undefined,
      })),
    });
    return;
  }

  next();
};
