import { describe, expect, it } from 'vitest';
import { durationToSeconds } from './token.service';

/*
 * `JWT_EXPIRES_IN` is a jsonwebtoken duration string, and it sizes the TTL on
 * the session-revocation record. Getting it wrong in the short direction is the
 * one failure that matters: a record that expires before the access tokens it
 * was written to refuse hands those tokens back, silently, some minutes after
 * the user pressed "sign out everywhere".
 *
 * So everything unreadable falls back long rather than short.
 */

describe('durationToSeconds', () => {
  it.each([
    ['15m', 900],
    ['1h', 3600],
    ['24h', 86_400],
    ['7d', 604_800],
    ['30s', 30],
  ])('reads %s', (input, expected) => {
    expect(durationToSeconds(input, 999)).toBe(expected);
  });

  it('treats a bare number as seconds, as jsonwebtoken does', () => {
    expect(durationToSeconds('3600', 999)).toBe(3600);
  });

  it('ignores surrounding whitespace and case', () => {
    expect(durationToSeconds(' 2H ', 999)).toBe(7200);
  });

  it.each([['', 'nonsense', '1 week', 'h1', '-5m', '1.5h']])(
    'falls back rather than throwing on %s',
    (input) => {
      expect(durationToSeconds(input as string, 4242)).toBe(4242);
    },
  );

  it('falls back on a value that is not a string at all', () => {
    // Config comes from the environment; nothing guarantees its shape.
    expect(durationToSeconds(undefined as unknown as string, 4242)).toBe(4242);
    expect(durationToSeconds(null as unknown as string, 4242)).toBe(4242);
  });
});
