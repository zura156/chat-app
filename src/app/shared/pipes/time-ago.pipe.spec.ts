import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TimeAgoPipe } from './time-ago.pipe';

/*
 * Relative timestamps on conversation rows, message bubbles and last-seen.
 *
 * Two design decisions here are worth pinning. The clock is a single shared
 * signal on a 30-second interval rather than a timer per pipe — a chat list can
 * hold hundreds of these, and one interval each is a measurable amount of
 * change detection. And anything under 29 seconds reads "just now", which is
 * the guard for clock skew: the server's timestamp on a message you just sent
 * is routinely a second or two in the future relative to the browser, and the
 * old code fell through every bucket and printed the raw timestamp.
 */

const NOW = new Date('2026-01-15T12:00:00.000Z').getTime();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

let pipe: TimeAgoPipe;

/** `value` rendered as of NOW. */
const ago = (elapsedMs: number) => pipe.transform(new Date(NOW - elapsedMs));

beforeAll(() => {
  /*
   * The shared clock is module state seeded at import and advanced only by its
   * interval, so it has to be wound forward onto a known instant before any
   * assertion. Constructing the pipe under fake timers is what puts that
   * interval on the fake clock in the first place.
   */
  vi.useFakeTimers();
  vi.setSystemTime(NOW - 30_000);
  pipe = new TimeAgoPipe();
  vi.advanceTimersByTime(30_000);
});

afterAll(() => vi.useRealTimers());

describe('TimeAgoPipe', () => {
  describe('the recent past', () => {
    it('says "just now" for something that has only just happened', () => {
      expect(ago(0)).toBe('just now');
      expect(ago(5 * SECOND)).toBe('just now');
      expect(ago(28 * SECOND)).toBe('just now');
    });

    it('starts counting seconds at 29', () => {
      // Boundary. Below it the skew guard wins; at it the buckets take over.
      expect(ago(28 * SECOND)).toBe('just now');
      expect(ago(29 * SECOND)).toBe('29s ago');
    });

    it('says "just now" for a timestamp in the future', () => {
      /*
       * The reason the threshold is not zero. Server and browser clocks
       * disagree by a second or two routinely, so a message you just sent
       * carries a timestamp slightly ahead of the browser's clock. Every
       * interval then divides to 0, and the old code fell through the loop and
       * printed the raw Date.
       */
      expect(ago(-2 * SECOND)).toBe('just now');
      expect(ago(-20 * SECOND)).toBe('just now');
    });

    it('does not print a raw timestamp for a badly skewed clock', () => {
      // A machine minutes ahead is unusual but not rare; whatever it renders
      // must still look like a relative time.
      const result = ago(-10 * MINUTE);
      expect(result).toBe('just now');
      expect(result).not.toContain('2026');
    });
  });

  describe('the buckets', () => {
    it.each([
      [45 * SECOND, '45s ago'],
      [59 * SECOND, '59s ago'],
      [MINUTE, '1m ago'],
      [90 * SECOND, '1m ago'],
      [5 * MINUTE, '5m ago'],
      [59 * MINUTE, '59m ago'],
      [HOUR, '1h ago'],
      [23 * HOUR, '23h ago'],
      [DAY, '1d ago'],
      [6 * DAY, '6d ago'],
      [WEEK, '1w ago'],
      [3 * WEEK, '3w ago'],
      [MONTH, '1mo ago'],
      [6 * MONTH, '6mo ago'],
      [YEAR, '1yr ago'],
      [3 * YEAR, '3yr ago'],
    ])('renders %ims as %s', (elapsed, expected) => {
      expect(ago(elapsed)).toBe(expected);
    });

    it('picks the largest bucket that fits', () => {
      // The loop returns on the first non-zero count, so the order of the
      // interval table is load-bearing — a reordering would render an hour-old
      // message as "3600s ago".
      expect(ago(2 * HOUR)).toBe('2h ago');
      expect(ago(2 * DAY)).toBe('2d ago');
      expect(ago(2 * WEEK)).toBe('2w ago');
    });

    it('rounds down rather than to nearest', () => {
      // "1h ago" for something 119 minutes old is the convention everywhere
      // else in the app; rounding up would show a future-sounding "2h".
      expect(ago(119 * MINUTE)).toBe('1h ago');
      expect(ago(HOUR + 59 * MINUTE)).toBe('1h ago');
      expect(ago(2 * HOUR - SECOND)).toBe('1h ago');
    });

    it('switches unit exactly on the boundary', () => {
      expect(ago(59 * SECOND)).toBe('59s ago');
      expect(ago(MINUTE)).toBe('1m ago');
      expect(ago(59 * MINUTE + 59 * SECOND)).toBe('59m ago');
      expect(ago(HOUR)).toBe('1h ago');
      expect(ago(DAY - SECOND)).toBe('23h ago');
      expect(ago(DAY)).toBe('1d ago');
      expect(ago(WEEK - SECOND)).toBe('6d ago');
      expect(ago(WEEK)).toBe('1w ago');
    });

    it('never renders a zero count', () => {
      // `counter > 0` is what stops "0m ago" appearing between the buckets.
      for (let seconds = 29; seconds < 400; seconds++) {
        expect(ago(seconds * SECOND)).not.toMatch(/^0/);
      }
    });
  });

  describe('what it accepts', () => {
    it('takes a Date, an ISO string or a number', () => {
      // Timestamps arrive as ISO strings from the API and as Dates once
      // something has parsed them.
      const then = NOW - 5 * MINUTE;
      expect(pipe.transform(new Date(then))).toBe('5m ago');
      expect(pipe.transform(new Date(then).toISOString())).toBe('5m ago');
      expect(pipe.transform(then)).toBe('5m ago');
    });

    it('renders nothing for a missing value', () => {
      // A conversation with no messages has no last-message time, and the row
      // renders before that is known.
      expect(pipe.transform('')).toBe('');
      expect(pipe.transform(null as unknown as Date)).toBe('');
      expect(pipe.transform(undefined as unknown as Date)).toBe('');
    });

    it('renders nothing for an unparseable date', () => {
      // Better an empty slot than "Invalid Date" in a chat list.
      expect(pipe.transform('not a date')).toBe('');
      expect(pipe.transform('2026-13-45T99:99:99Z')).toBe('');
      expect(pipe.transform(Number.NaN)).toBe('');
    });
  });

  describe('the shared clock', () => {
    it('re-renders as time passes without the value changing', () => {
      /*
       * The pipe is impure so Angular re-runs it, but the *answer* only
       * changes because the shared signal ticks. Without the interval, a chat
       * list opened at midnight still says "just now" an hour later.
       */
      const sent = new Date(NOW - 40 * SECOND);
      expect(pipe.transform(sent)).toBe('40s ago');

      vi.advanceTimersByTime(30_000);
      expect(pipe.transform(sent)).toBe('1m ago');

      vi.advanceTimersByTime(30_000);
      expect(pipe.transform(sent)).toBe('1m ago');

      // Wind back so the rest of the file still sees NOW.
      vi.setSystemTime(NOW - 30_000);
      vi.advanceTimersByTime(30_000);
    });

    it('does not start a second interval for a second pipe', () => {
      /*
       * The guard that makes this affordable in a long list. Every row
       * constructs a pipe; one interval each would be hundreds of timers all
       * waking change detection on their own schedule.
       */
      const before = vi.getTimerCount();

      new TimeAgoPipe();
      new TimeAgoPipe();
      new TimeAgoPipe();

      expect(vi.getTimerCount()).toBe(before);
    });

    it('gives every pipe the same answer', () => {
      // They read one signal, so a list cannot show two different ages for the
      // same timestamp.
      const sent = new Date(NOW - 5 * MINUTE);
      expect(new TimeAgoPipe().transform(sent)).toBe(pipe.transform(sent));
    });
  });
});
