import { describe, expect, it } from 'vitest';
import { pseudoWaveform } from './pseudo-waveform';

/*
 * The bars behind a voice message. Not real audio data — the seed is an
 * attachment id — so the only property that matters to a user is that it is
 * *stable*: the same message must draw the same shape every time it scrolls
 * back into view, and two different messages must not look identical.
 *
 * Both of those come from the hash, and both fail silently. A seeding mistake
 * gives every voice note the same waveform, which reads as "the player is
 * broken" rather than as a bug in a hash function.
 */

describe('pseudoWaveform', () => {
  it('produces the same bars for the same seed, every time', () => {
    // The whole reason this exists rather than Math.random().
    const first = pseudoWaveform('upload-abc123');
    const second = pseudoWaveform('upload-abc123');
    expect(second).toEqual(first);
  });

  it('produces different bars for different seeds', () => {
    expect(pseudoWaveform('upload-a')).not.toEqual(pseudoWaveform('upload-b'));
  });

  it('separates seeds differing in one character', () => {
    // Attachment ids are near-identical strings — a hash that only mixes the
    // tail would give a whole conversation the same shape.
    const a = pseudoWaveform('507f1f77bcf86cd799439011');
    const b = pseudoWaveform('507f1f77bcf86cd799439012');
    expect(a).not.toEqual(b);
  });

  it('is sensitive to character order, not just content', () => {
    expect(pseudoWaveform('ab')).not.toEqual(pseudoWaveform('ba'));
  });

  it('returns 28 bars by default', () => {
    // The default is what every call site uses; the row is laid out for it.
    expect(pseudoWaveform('x')).toHaveLength(28);
  });

  it.each([1, 8, 28, 64])('returns exactly %i bars when asked', (bars) => {
    expect(pseudoWaveform('x', bars)).toHaveLength(bars);
  });

  it('returns nothing for zero bars rather than throwing', () => {
    expect(pseudoWaveform('x', 0)).toEqual([]);
  });

  it('keeps every bar within the visible range', () => {
    /*
     * The floor is what stops a bar rendering as an invisible sliver, and the
     * ceiling is what stops one overflowing the row. Both are load-bearing for
     * the layout, so they are checked across many seeds rather than one.
     */
    for (let i = 0; i < 200; i++) {
      for (const value of pseudoWaveform(`seed-${i}`)) {
        expect(value).toBeGreaterThanOrEqual(0.2);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('actually varies within a single waveform', () => {
    // A hash that stopped advancing would still satisfy every range check
    // above while drawing 28 identical bars.
    const bars = pseudoWaveform('upload-abc123');
    expect(new Set(bars).size).toBeGreaterThan(bars.length / 2);
  });

  it('uses most of the available height across a run', () => {
    // Guards against a shape that is technically varied but visually flat.
    const bars = pseudoWaveform('upload-abc123', 64);
    expect(Math.max(...bars) - Math.min(...bars)).toBeGreaterThan(0.4);
  });

  it('handles an empty seed', () => {
    // Reached when an attachment is rendered before its id exists.
    const bars = pseudoWaveform('');
    expect(bars).toHaveLength(28);
    expect(bars.every((v) => v >= 0.2 && v <= 1)).toBe(true);
  });

  it('handles seeds outside the ASCII range', () => {
    // `charCodeAt` on an emoji yields surrogate halves; nothing here should
    // care, but the arithmetic is bitwise and worth a look.
    const bars = pseudoWaveform('🎤 voice note');
    expect(bars).toHaveLength(28);
    expect(bars.every(Number.isFinite)).toBe(true);
  });

  it('gives a longer request the same opening bars as a shorter one', () => {
    // The generator is a stream off one seed, so widening the row must extend
    // the shape rather than redraw it.
    expect(pseudoWaveform('x', 40).slice(0, 28)).toEqual(pseudoWaveform('x', 28));
  });
});
