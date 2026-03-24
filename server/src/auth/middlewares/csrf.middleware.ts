import { Request, Response, NextFunction } from 'express';

// Double Submit Cookie pattern — no server-side storage needed.
// Client reads csrfToken cookie (non-httpOnly) and sends it as X-CSRF-TOKEN header.
// Server just compares cookie value vs header value.
export const csrfProtection = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const methodsToProtect = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (!methodsToProtect.includes(req.method)) {
    next();
    return;
  }

  const cookieToken = req.cookies.csrfToken as string | undefined;
  const headerToken = req.headers['x-csrf-token'] as string | undefined;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ message: 'Invalid CSRF token' });
    return;
  }

  next();
};
