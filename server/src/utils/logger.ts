import path from 'path';
import fs from 'fs';
import winston from 'winston';

/*
 * The previous format was a printf that interpolated only `{ timestamp, level,
 * message }`. Everything else was dropped: `logger.error('Job failed', { jobId,
 * uploadId, error })` logged the two words and none of the context, and
 * `logger.error('Redis error:', err)` logged no error at all. Every structured
 * call in the codebase — and there are many — was writing to nowhere, which is
 * the worst possible failure mode for logging because it looks like it works.
 *
 * `errors({ stack: true })` promotes an Error passed as the message into a real
 * stack; `splat()` plus the serialiser below keep everything else.
 */

const LOG_DIR = path.resolve(
  process.env.LOG_DIR ?? path.join(process.cwd(), 'logs'),
);

// Winston's File transport does not create intermediate directories. The old
// path (`error-handling/log/`) does not exist in the container image, so the
// transport threw on first write.
fs.mkdirSync(LOG_DIR, { recursive: true });

const SPLAT = Symbol.for('splat') as unknown as string;

/** Anything that is not timestamp/level/message, rendered readably. */
const serializeMeta = (info: winston.Logform.TransformableInfo): string => {
  const { timestamp, level, message, stack, ...rest } = info as Record<
    string,
    unknown
  >;

  const splat = rest[SPLAT];
  delete rest[SPLAT];

  const extras: unknown[] = [];
  if (Object.keys(rest).length > 0) extras.push(rest);
  if (Array.isArray(splat)) extras.push(...splat);

  if (extras.length === 0) return '';

  const rendered = extras
    .map((value) => {
      if (value instanceof Error) return value.stack ?? value.message;
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .filter(Boolean)
    .join(' ');

  return rendered ? ` ${rendered}` : '';
};

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf((info) => {
    const base = `[${info.timestamp}] ${String(info.level).toUpperCase()}: ${info.message}`;
    const stack = info.stack ? `\n${info.stack}` : '';
    return `${base}${serializeMeta(info)}${stack}`;
  }),
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  /*
   * Set by the test setup, which turns it on unless the environment already
   * says otherwise — so `LOG_SILENT=0 npm test` gets the output back when you
   * are actually debugging a spec.
   *
   * Several specs assert on failure paths, which means calling the code that
   * logs the failure. Those messages are the test working, but they arrive as a
   * wall of stack traces indistinguishable from something being wrong, and they
   * were also being written to `logs/error.log` — tens of kilobytes per run,
   * against a transport that rotates at 10MB and keeps five files.
   */
  silent: process.env.LOG_SILENT === '1',
  format: logFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      // Bounded, so a noisy failure cannot fill the disk. There was neither a
      // size limit nor rotation before.
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
});
