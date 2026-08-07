import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { apiErrorMessage, apiFieldErrors } from './api-error';

/*
 * Each case here is a shape that reached a user as something unhelpful.
 *
 * The failures this replaces were all of the same kind: the reason existed, in
 * the response, and the code that rendered it looked in the wrong place — so
 * the user was told an operation failed and never why.
 */

const response = (status: number, body: unknown): HttpErrorResponse =>
  new HttpErrorResponse({ status, error: body, url: '/api/thing' });

describe('apiErrorMessage', () => {
  it('prefers the field reasons over the generic validation headline', () => {
    // The exact payload /auth/register answers. `message` alone is useless and
    // it is what every reader used to take.
    const error = response(400, {
      message: 'Validation failed',
      code: 'VALIDATION_FAILED',
      errors: [
        {
          field: 'username',
          msg: 'Username must be between 3 and 32 characters',
        },
        { field: 'password', msg: 'This is a well-known password.' },
      ],
    });

    const message = apiErrorMessage(error, 'fallback');

    expect(message).toContain('Username must be between 3 and 32 characters');
    expect(message).toContain('This is a well-known password.');
    expect(message).not.toContain('Validation failed');
  });

  it('uses a real summary when the server sent one', () => {
    const error = response(400, {
      message: 'Your current password is incorrect.',
    });

    expect(apiErrorMessage(error, 'fallback')).toBe(
      'Your current password is incorrect.',
    );
  });

  it('reads the `error` key the upload routes used to answer with', () => {
    const error = response(400, { error: 'File too large' });

    expect(apiErrorMessage(error, 'fallback')).toBe('File too large');
  });

  it('never surfaces Angular transport boilerplate', () => {
    // `err.message` here is "Http failure response for /api/thing: 400 …",
    // which is what the file picker was showing as the reason an upload failed.
    const error = response(400, null);

    const message = apiErrorMessage(error, 'Upload failed');

    expect(message).not.toContain('Http failure');
    expect(message).toBe('Upload failed');
  });

  it('describes a network failure rather than blaming the operation', () => {
    const error = new HttpErrorResponse({
      status: 0,
      error: new ProgressEvent('error'),
    });

    expect(apiErrorMessage(error, 'Could not save your profile')).toContain(
      'Could not reach the server',
    );
  });

  it('passes a bare string through, for the callers that still get one', () => {
    expect(apiErrorMessage('That code is not correct', 'fallback')).toBe(
      'That code is not correct',
    );
  });

  it('parses a JSON body that arrived as text', () => {
    const error = response(409, JSON.stringify({ message: 'Already taken' }));

    expect(apiErrorMessage(error, 'fallback')).toBe('Already taken');
  });

  it('falls back to a status-appropriate line when the body says nothing', () => {
    expect(apiErrorMessage(response(500, {}), 'fallback')).toContain(
      'on our end',
    );
    expect(apiErrorMessage(response(429, {}), 'fallback')).toContain(
      'Too many attempts',
    );
  });

  it('prefers the server rate-limit message over the generic one', () => {
    const error = response(429, {
      message: 'Too many attempts. Try again in 5 minutes.',
      retryAfter: 300,
    });

    expect(apiErrorMessage(error, 'fallback')).toBe(
      'Too many attempts. Try again in 5 minutes.',
    );
  });

  it('uses the caller fallback only when there is genuinely nothing', () => {
    expect(apiErrorMessage(response(418, {}), 'Could not brew coffee')).toBe(
      'Could not brew coffee',
    );
  });
});

describe('apiFieldErrors', () => {
  it('keys the reasons by field so a form can place them', () => {
    const error = response(400, {
      message: 'Validation failed',
      errors: [
        { field: 'email', msg: 'Valid email required' },
        { field: 'username', msg: 'Letters only' },
      ],
    });

    expect(apiFieldErrors(error)).toEqual({
      email: 'Valid email required',
      username: 'Letters only',
    });
  });

  it('keeps the first reason per field', () => {
    const error = response(400, {
      errors: [
        { field: 'username', msg: 'Too short' },
        { field: 'username', msg: 'Letters only' },
      ],
    });

    expect(apiFieldErrors(error)).toEqual({ username: 'Too short' });
  });

  it('drops entries with no field — those belong in the summary', () => {
    const error = response(400, {
      errors: [{ msg: 'The body is malformed' }],
    });

    expect(apiFieldErrors(error)).toEqual({});
  });

  it('is empty for a failure that carries no body', () => {
    expect(apiFieldErrors(response(500, null))).toEqual({});
  });
});
