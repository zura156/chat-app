import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import config from '../../config/config';

/*
 * Double Submit Cookie — no server-side storage needed. The client reads the
 * csrfToken cookie (deliberately not httpOnly) and echoes it in X-CSRF-TOKEN;
 * the server checks the two match. An attacker's page can make the browser
 * *send* the cookie but cannot read it to construct the header.
 *
 * The token used to be minted only at login, which meant the endpoints that run
 * before a session exists — login itself, register, refresh, reset-password —
 * had no token to submit and so could not be protected at all. `ensureCsrfCookie`
 * fixes that by seeding one on any safe request, so the SPA always holds a
 * token by the time it posts anything.
 */

const CSRF_COOKIE = 'csrfToken';
const CSRF_HEADER = 'x-csrf-token';

const TOKEN_BYTES = 32;

export const issueCsrfToken = (res: Response): string => {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');

  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    domain: config.cookieDomain,
    maxAge: 24 * 60 * 60 * 1000,
  });

  return token;
};

/** Safe methods carry no risk and are the natural place to hand out a token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const ensureCsrfCookie = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (SAFE_METHODS.has(req.method) && !req.cookies?.[CSRF_COOKIE]) {
    issueCsrfToken(res);
  }
  next();
};

/**
 * Compares without leaking how much of the token matched. `!==` on secrets
 * short-circuits at the first differing byte; over enough requests that is a
 * measurable signal.
 */
const tokensMatch = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export const csrfProtection = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
    res.status(403).json({ message: 'Invalid CSRF token', code: 'CSRF' });
    return;
  }

  next();
};
