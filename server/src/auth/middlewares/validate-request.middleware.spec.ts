import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { body, ValidationChain } from 'express-validator';
import { validateRequest } from './validate-request.middleware';

/*
 * The contract this middleware owes the client.
 *
 * It answered `{ message: 'Validation failed' }` with the real reasons tucked
 * into `errors[]` — and every reader in the Angular app takes `message` first,
 * so the reasons were produced, serialised and never seen. A password refused
 * for being on a breach list and a username refused for containing a space were
 * reported identically, and the user had six fields and no clue.
 *
 * These lock in that `message` alone explains the refusal, without giving up
 * the per-field breakdown a form needs in order to place each reason under the
 * input it belongs to.
 */

interface MockResponse {
  statusCode?: number;
  body?: any;
}

const mockResponse = (): MockResponse & Response => {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };

  return res as unknown as MockResponse & Response;
};

/** Runs the chains the way a route would, then the middleware under test. */
const validate = async (
  chains: ValidationChain[],
  requestBody: Record<string, unknown>,
) => {
  const req = { body: requestBody } as Request;
  const res = mockResponse();
  const next = vi.fn() as unknown as NextFunction;

  for (const chain of chains) await chain.run(req);
  validateRequest(req, res, next);

  return { res, next };
};

describe('validateRequest', () => {
  it('passes a valid body through', async () => {
    const { res, next } = await validate([body('email').isEmail()], {
      email: 'ada@example.test',
    });

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('names the field and the reason in `message`', async () => {
    const { res } = await validate(
      [
        body('username')
          .isLength({ min: 3 })
          .withMessage('Username must be between 3 and 32 characters'),
      ],
      { username: 'ab' },
    );

    expect(res.statusCode).toBe(400);
    // The whole point: readable without consulting `errors`.
    expect(res.body.message).toBe(
      'Username must be between 3 and 32 characters',
    );
    expect(res.body.message).not.toBe('Validation failed');
  });

  it('prefixes the label when the message carries no subject of its own', async () => {
    const { res } = await validate(
      [
        body('new_password')
          .isLength({ min: 8 })
          .withMessage('Use at least 8 characters.'),
      ],
      { new_password: 'short' },
    );

    // "Use at least 8 characters." on its own does not say *what* must be 8.
    expect(res.body.message).toBe('New password: Use at least 8 characters.');
  });

  it('reports every failing field, not only the first', async () => {
    const { res } = await validate(
      [
        body('email').isEmail().withMessage('Valid email required'),
        body('username')
          .isLength({ min: 3 })
          .withMessage('Username must be between 3 and 32 characters'),
      ],
      { email: 'not-an-address', username: 'x' },
    );

    expect(res.body.message).toContain('Valid email required');
    expect(res.body.message).toContain('Username must be between 3 and 32');
  });

  it('keeps the per-field breakdown so a form can place each reason', async () => {
    const { res } = await validate(
      [body('email').isEmail().withMessage('Valid email required')],
      { email: 'nope' },
    );

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([
      { field: 'email', msg: 'Valid email required' },
    ]);
  });

  it('reports a field once even when two of its validators fail', async () => {
    const { res } = await validate(
      [
        body('username').isLength({ min: 3 }).withMessage('Too short'),
        body('username')
          .matches(/^[a-z]+$/)
          .withMessage('Letters only'),
      ],
      { username: '1' },
    );

    expect(res.body.errors).toHaveLength(1);
    // One label, not "Username: Too short Username: Letters only".
    expect(res.body.message).toBe('Username: Too short');
  });
});
