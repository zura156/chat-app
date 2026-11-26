import { describe, expect, it } from 'vitest';
import { CONTEXT_CONFIG } from '../../config/upload.config';
import {
  hasSignature,
  matchesDeclaredType,
} from '../../utils/file-signature';

const bytes = (...b: number[]) => Uint8Array.from(b);
const ascii = (s: string) => new TextEncoder().encode(s);

const OLE2 = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const SEVEN_ZIP = bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04);
const RAR = ascii('Rar!\x1a\x07\x01\x00');
const PDF = ascii('%PDF-1.7\n%âãÏÓ\n');

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

describe('matchesDeclaredType', () => {
  // One file that fits and one that doesn't, per row of the table.
  const rows: [string, Uint8Array, Uint8Array][] = [
    ['application/pdf', PDF, ZIP],
    ['application/msword', OLE2, ZIP],
    ['application/vnd.ms-excel', OLE2, PDF],
    ['application/vnd.ms-powerpoint', OLE2, ZIP],
    [DOCX, ZIP, OLE2],
    [XLSX, ZIP, PDF],
    [PPTX, ZIP, OLE2],
    ['application/zip', ZIP, RAR],
    ['application/x-7z-compressed', SEVEN_ZIP, ZIP],
    ['application/x-rar-compressed', RAR, SEVEN_ZIP],
    ['text/plain', ascii('hello\n'), ZIP],
    ['text/csv', ascii('a,b\n1,2\n'), bytes(0x61, 0x00, 0x62)],
  ];

  it.each(rows)('%s: accepts its own signature', (type, good) => {
    expect(matchesDeclaredType(type, good)).toBe(true);
  });

  it.each(rows)('%s: refuses another one', (type, _good, bad) => {
    expect(matchesDeclaredType(type, bad)).toBe(false);
  });

  it('finds a PDF header after leading junk, within 1024 bytes', () => {
    const late = new Uint8Array(1100);
    late.set(ascii('%PDF-'), 1000);
    expect(matchesDeclaredType('application/pdf', late)).toBe(true);
  });

  it('refuses a PDF header past the first 1024 bytes', () => {
    const tooLate = new Uint8Array(1100);
    tooLate.set(ascii('%PDF-'), 1020); // starts inside, ends outside
    expect(matchesDeclaredType('application/pdf', tooLate)).toBe(false);
  });

  it('refuses a ZIP declared as a PDF', () => {
    expect(matchesDeclaredType('application/pdf', ZIP)).toBe(false);
  });

  it('passes HTML declared as text/plain: the stored headers make it inert', () => {
    expect(
      matchesDeclaredType('text/plain', ascii('<script>alert(1)</script>')),
    ).toBe(true);
  });

  it('passes UTF-8 text cut off in the middle of a character', () => {
    const cut = ascii('naïve café ✓').slice(0, -1); // ✓ is 3 bytes
    expect(matchesDeclaredType('text/plain', cut)).toBe(true);
  });

  it('refuses text that is not UTF-8', () => {
    // "café au lait" in Windows-1252. Mid-text on purpose: a lone 0xE9 as the
    // last byte looks like a character the sample cut, and passes.
    expect(
      matchesDeclaredType('text/plain', bytes(0x63, 0x61, 0x66, 0xe9, 0x20, 0x61)),
    ).toBe(false);
    expect(matchesDeclaredType('text/plain', bytes(0xff, 0xfe, 0x68, 0x00))).toBe(
      false,
    ); // UTF-16LE with its byte order mark
  });

  it('refuses an empty sample for every type', () => {
    for (const [type] of rows) {
      expect(matchesDeclaredType(type, new Uint8Array())).toBe(false);
    }
  });

  it('refuses a type the table does not know', () => {
    expect(matchesDeclaredType('text/html', ascii('<p>hi</p>'))).toBe(false);
    expect(matchesDeclaredType('constructor', ascii('x'))).toBe(false);
  });

  it('knows every type a dm-file may be declared as', () => {
    const missing = CONTEXT_CONFIG['dm-file'].allowedMimes.filter(
      (type) => !hasSignature(type),
    );
    expect(missing).toEqual([]);
  });
});
