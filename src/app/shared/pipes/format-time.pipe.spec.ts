import { describe, expect, it } from 'vitest';
import { FormatTimePipe } from './format-time.pipe';

/*
 * Drives the elapsed/remaining readout on the audio and video players, and the
 * live counter on the recorder — so it is fed `currentTime` from a media
 * element, which is a float, can be NaN before metadata loads, and is
 * occasionally a hair negative during a seek. All three of those render as
 * text rather than throwing, which is why they need pinning.
 */

const format = (seconds: number) => new FormatTimePipe().transform(seconds);

describe('FormatTimePipe', () => {
  it.each([
    [0, '00:00'],
    [5, '00:05'],
    [59, '00:59'],
    [60, '01:00'],
    [61, '01:01'],
    [599, '09:59'],
    [3599, '59:59'],
  ])('renders %is as %s', (seconds, expected) => {
    expect(format(seconds)).toBe(expected);
  });

  it('adds an hours field only once there is an hour', () => {
    expect(format(3599)).toBe('59:59');
    expect(format(3600)).toBe('1:00:00');
    expect(format(3661)).toBe('1:01:01');
  });

  it('adds a days field only once there is a day', () => {
    expect(format(86399)).toBe('23:59:59');
    expect(format(86400)).toBe('1d 0:00:00');
    expect(format(90061)).toBe('1d 1:01:01');
  });

  it('keeps the hours field once days are shown, even at zero hours', () => {
    // Omitting it renders 1d 0h 5m as "1d 05:00", which is indistinguishable
    // from five minutes past the day.
    expect(format(86400 + 300)).toBe('1d 0:05:00');
    expect(format(2 * 86400)).toBe('2d 0:00:00');
  });

  it('truncates fractional seconds rather than rendering them', () => {
    // `HTMLMediaElement.currentTime` is a float and updates continuously; an
    // unfloored value would render "00:5.234".
    expect(format(5.9)).toBe('00:05');
    expect(format(59.999)).toBe('00:59');
  });

  it('falls back to zero for values a media element can genuinely produce', () => {
    // `currentTime` is NaN before metadata loads and `duration` is NaN for a
    // live stream; both reach this pipe on first render.
    expect(format(Number.NaN)).toBe('0:00');
    expect(format(-1)).toBe('0:00');
    expect(format(undefined as unknown as number)).toBe('0:00');
  });

  it('keeps minutes and seconds two digits wide', () => {
    // The readout sits next to a progress bar; a width that changes with the
    // value makes the bar jump.
    expect(format(65)).toBe('01:05');
    expect(format(3725)).toBe('1:02:05');
  });
});
