import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { isFinalAttempt } from '../../processors/final-attempt';

/*
 * The worker's `failed` handler marks an upload failed only on a final
 * failure. An UnrecoverableError (a dm-file whose bytes don't fit its type,
 * SECURITY-FIXES.md 2.3b) ends a job on its first attempt, and wasn't counted
 * as final, so that upload stayed "processing" forever.
 */

const job = (attemptsMade: number, attempts = 3) => ({
  attemptsMade,
  opts: { attempts },
});

describe('isFinalAttempt', () => {
  it('is not final while retries are left', () => {
    expect(isFinalAttempt(job(1), new Error('timeout'))).toBe(false);
    expect(isFinalAttempt(job(2), new Error('timeout'))).toBe(false);
  });

  it('is final on the last attempt', () => {
    expect(isFinalAttempt(job(3), new Error('timeout'))).toBe(true);
  });

  it('is final on an UnrecoverableError, with attempts left', () => {
    expect(isFinalAttempt(job(1), new UnrecoverableError('bad bytes'))).toBe(
      true,
    );
  });

  it('is final on an error named UnrecoverableError, as bullmq treats it', () => {
    const err = new Error('bad bytes');
    err.name = 'UnrecoverableError';
    expect(isFinalAttempt(job(1), err)).toBe(true);
  });

  it('is final when there is no job to retry', () => {
    expect(isFinalAttempt(undefined, new Error('lost'))).toBe(true);
  });

  it('takes one attempt when the job sets none', () => {
    expect(isFinalAttempt({ attemptsMade: 1, opts: {} }, new Error('x'))).toBe(
      true,
    );
  });
});
