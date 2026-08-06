import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { csrfProtection, ensureCsrfCookie } from './csrf.middleware';

/*
 * Double-submit is only as good as the comparison. Two failure modes matter and
 * neither shows up as an error:
 *
 *   - accepting a request with no header at all (the classic "if the cookie is
 *     there, fine" bug), which makes the whole scheme decorative;
 *   - `timingSafeEqual` throwing on unequal lengths, which turns a mismatched
 *     token into an unhandled 500 instead of a 403.
 */

interface RecordedCookie {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

/** Just enough of `Response` for these two middlewares, plus what they wrote. */
interface MockResponse {
  statusCode?: number;
  body?: unknown;
  cookies: RecordedCookie[];
}

/**
 * Returned as both shapes: the middleware needs an express `Response`, the
 * assertions need the recording. One object, two views of it — rather than a
 * chain of casts on every method.
 */
const mockResponse = (): MockResponse & Response => {
  const recorder: MockResponse = { cookies: [] };

  const res = {
    ...recorder,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    cookie(name: string, value: string, options: Record<string, unknown> = {}) {
      res.cookies.push({ name, value, options });
      return res;
    },
  } as unknown as MockResponse & Response;

  return res;
};

const mockRequest = (
  method: string,
  { cookie, header }: { cookie?: string; header?: string } = {},
): Request =>
  ({
    method,
    cookies: cookie ? { csrfToken: cookie } : {},
    headers: header ? { 'x-csrf-token': header } : {},
  }) as unknown as Request;

const run = (req: Request) => {
  const res = mockResponse();
  const next = vi.fn();
  csrfProtection(req, res, next as unknown as NextFunction);
  return { res, next };
};

const TOKEN = crypto.randomBytes(32).toString('hex');

describe('csrfProtection', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'lets %s through without a token',
    (method) => {
      const { next, res } = run(mockRequest(method));
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeUndefined();
    },
  );

  it('allows a mutating request whose header matches its cookie', () => {
    const { next } = run(
      mockRequest('POST', { cookie: TOKEN, header: TOKEN }),
    );
    expect(next).toHaveBeenCalled();
  });

  it.each([
    ['neither cookie nor header', {}],
    ['a cookie but no header', { cookie: TOKEN }],
    ['a header but no cookie', { header: TOKEN }],
  ])('refuses a POST with %s', (_label, parts) => {
    // The middle case is the important one: a cross-site page *can* make the
    // browser send the cookie, and cannot read it to build the header. If that
    // ever passes, the protection is gone.
    const { next, res } = run(mockRequest('POST', parts));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'CSRF' });
  });

  it('refuses a mismatched token of a different length without throwing', () => {
    // crypto.timingSafeEqual throws on unequal lengths — guarded, this is a
    // 403; unguarded it is an unhandled exception and a 500.
    const { next, res } = run(
      mockRequest('POST', { cookie: TOKEN, header: 'short' }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('refuses a same-length token that differs by one character', () => {
    const nearMiss = `${TOKEN.slice(0, -1)}${TOKEN.endsWith('a') ? 'b' : 'a'}`;
    const { next, res } = run(
      mockRequest('POST', { cookie: TOKEN, header: nearMiss }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('guards %s as well as POST', (method) => {
    const { res } = run(mockRequest(method));
    expect(res.statusCode).toBe(403);
  });
});

describe('ensureCsrfCookie', () => {
  it('seeds a token on a safe request when the client has none', () => {
    // This is what lets login and register be protected at all: the SPA has to
    // be holding a token before its first mutating request.
    const res = mockResponse();
    ensureCsrfCookie(mockRequest('GET'), res, vi.fn() as unknown as NextFunction);

    expect(res.cookies).toHaveLength(1);
    expect(res.cookies[0].name).toBe('csrfToken');
    expect(res.cookies[0].value).toMatch(/^[0-9a-f]{64}$/);
    // Read by JS to echo back as a header, so it must not be httpOnly.
    expect(res.cookies[0].options.httpOnly).toBe(false);
  });

  it('does not reissue when the client already holds one', () => {
    // Reissuing would invalidate the token an in-flight request is carrying.
    const res = mockResponse();
    ensureCsrfCookie(
      mockRequest('GET', { cookie: TOKEN }),
      res,
      vi.fn() as unknown as NextFunction,
    );
    expect(res.cookies).toHaveLength(0);
  });

  it('does not seed on an unsafe method', () => {
    // A POST that arrives without a token is a failure, not an opportunity to
    // hand the caller the very token they were missing.
    const res = mockResponse();
    ensureCsrfCookie(mockRequest('POST'), res, vi.fn() as unknown as NextFunction);
    expect(res.cookies).toHaveLength(0);
  });

  it('always calls next', () => {
    for (const method of ['GET', 'POST']) {
      const next = vi.fn();
      ensureCsrfCookie(
        mockRequest(method),
        mockResponse(),
        next as unknown as NextFunction,
      );
      expect(next).toHaveBeenCalledOnce();
    }
  });
});
