import { describe, expect, it } from 'vitest';
import { FileSizePipe } from './file-size.pipe';

/*
 * Renders the size on every attachment chip and every row of the files panel.
 * The input is `fileSize` off an attachment record, which the API stores as a
 * number but which arrives as a string from some older documents — hence the
 * string branch, which is easy to remove by accident.
 */

const format = (value: number | string) => new FileSizePipe().transform(value);

describe('FileSizePipe', () => {
  it('reports bytes below a kilobyte, without a decimal', () => {
    expect(format(0)).toBe('0 B');
    expect(format(1)).toBe('1 B');
    expect(format(1023)).toBe('1023 B');
  });

  it.each([
    [1024, '1.00 KB'],
    [1536, '1.50 KB'],
    [1024 * 1024 - 1, '1024.00 KB'],
    [1024 * 1024, '1.00 MB'],
    [5 * 1024 * 1024, '5.00 MB'],
    [1024 ** 3, '1.00 GB'],
    [2.5 * 1024 ** 3, '2.50 GB'],
  ])('scales %i to %s', (bytes, expected) => {
    expect(format(bytes)).toBe(expected);
  });

  it('switches unit exactly at each boundary', () => {
    expect(format(1023)).toBe('1023 B');
    expect(format(1024)).toBe('1.00 KB');
    expect(format(1024 ** 2 - 1)).toBe('1024.00 KB');
    expect(format(1024 ** 2)).toBe('1.00 MB');
  });

  it('accepts a numeric string', () => {
    expect(format('2048')).toBe('2.00 KB');
    expect(format('500')).toBe('500 B');
  });

  it('returns null for something that is not a size', () => {
    // Rendered directly into the template, so returning null is what makes the
    // chip show nothing rather than "NaN B".
    expect(format('not a number')).toBeNull();
    expect(format(Number.NaN)).toBeNull();
    expect(format(undefined as unknown as number)).toBeNull();
  });
});
