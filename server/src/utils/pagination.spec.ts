import { describe, expect, it } from 'vitest';
import { clampLimit, clampOffset } from './pagination';

/*
 * These replaced `parseInt(x) || default` at every call site. The two things
 * that fell out of that pattern — an unbounded `limit` and a negative `offset`
 * reaching `.skip()` — are what the boundary cases below pin down.
 */

describe('clampLimit', () => {
  it('passes through a sensible request', () => {
    expect(clampLimit('20')).toBe(20);
    expect(clampLimit(50)).toBe(50);
  });

  it('caps an oversized request instead of honouring it', () => {
    // `?limit=1000000` asked Mongo for an entire conversation in one response.
    expect(clampLimit('1000000')).toBe(100);
    expect(clampLimit(Number.MAX_SAFE_INTEGER)).toBe(100);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['non-numeric', 'twenty'],
    ['zero', '0'],
    ['negative', '-5'],
    ['NaN', Number.NaN],
    ['an object', {}],
  ])('falls back to the default for %s', (_label, raw) => {
    expect(clampLimit(raw)).toBe(20);
  });

  it('honours a caller-specific ceiling', () => {
    expect(clampLimit('500', { max: 10 })).toBe(10);
    expect(clampLimit('', { fallback: 5 })).toBe(5);
  });

  it('truncates a fractional limit rather than passing it to Mongo', () => {
    expect(clampLimit('7.9')).toBe(7);
  });

  it('accepts exactly the maximum', () => {
    expect(clampLimit('100')).toBe(100);
    expect(clampLimit('101')).toBe(100);
  });
});

describe('clampOffset', () => {
  it('passes through a valid offset, including zero', () => {
    expect(clampOffset('0')).toBe(0);
    expect(clampOffset('40')).toBe(40);
  });

  it.each([
    ['negative', '-1'],
    ['very negative', '-999999'],
    ['non-numeric', 'abc'],
    ['undefined', undefined],
    ['null', null],
  ])('floors %s at zero', (_label, raw) => {
    // A negative skip is a driver error, which surfaced as a 500 rather than
    // as the 400 it actually was.
    expect(clampOffset(raw)).toBe(0);
  });

  it('has no ceiling — paging deep is legitimate', () => {
    expect(clampOffset('1000000')).toBe(1_000_000);
  });
});
