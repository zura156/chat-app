/*
 * Pagination parameters arrive as strings from the query and were parsed with
 * `parseInt(x) || default`, unbounded, at every call site. Two things fell out
 * of that:
 *
 *   - `limit` had no ceiling, so `?limit=1000000` asked Mongo for an entire
 *     conversation in one response. One caller clamped; the rest did not.
 *   - `offset` had no floor, and a negative one reaches `.skip()` as an error,
 *     which surfaced as a 500 rather than a 400.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** How many rows a caller may ask for, whatever they actually asked for. */
export const clampLimit = (
  raw: unknown,
  { fallback = DEFAULT_LIMIT, max = MAX_LIMIT } = {},
): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

/** Never negative, never fractional. */
export const clampOffset = (raw: unknown): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};
