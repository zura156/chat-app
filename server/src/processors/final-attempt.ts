import { Job, UnrecoverableError } from 'bullmq';

/**
 * Whether a failed job is done for good: nothing will run it again, so its
 * upload must be marked failed and its temp object removed now.
 *
 * `attemptsMade` counts the attempt that just failed (verified against bullmq
 * 5.x), so the last of three compares equal to `attempts` and nothing before it
 * does. An `UnrecoverableError` fails a job at once with attempts left; bullmq
 * recognises it by class or by name, and so does this. Without that case, an
 * upload refused for good (its bytes don't fit its type, SECURITY-FIXES.md 2.3b)
 * stayed "processing" forever.
 */
export const isFinalAttempt = (
  job: Pick<Job, 'attemptsMade' | 'opts'> | undefined,
  err: Error,
): boolean =>
  !job ||
  err instanceof UnrecoverableError ||
  err.name === 'UnrecoverableError' ||
  job.attemptsMade >= (job.opts?.attempts ?? 1);
