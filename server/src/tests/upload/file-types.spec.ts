import { describe, expect, it } from 'vitest';
import { CONTEXT_CONFIG } from '../../config/upload.config';
import {
  attachmentFor,
  contentTypeFor,
  downloadOverrides,
  extensionOf,
} from '../../upload/file-types';

/*
 * The headers a signed GET forces onto a dm-file (SECURITY-FIXES.md 2.3c).
 * Files stored before 2.3c kept whatever Content-Type their client's PUT sent,
 * so the type has to come from the key, which the API built itself. Keys made
 * before 5 Aug 2026 end in the mime subtype rather than today's extension.
 */

const key = (name: string) => `dm-file/6740c0ffee00000000000001/a1b2c3d4/${name}`;

describe('downloadOverrides', () => {
  it.each([
    ['original.txt', 'text/plain; charset=utf-8', 'file.txt'],
    ['original.csv', 'text/csv; charset=utf-8', 'file.csv'],
    ['original.pdf', 'application/pdf', 'file.pdf'],
    [
      'original.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'file.docx',
    ],
    ['original.7z', 'application/x-7z-compressed', 'file.7z'],
  ])('serves today\'s %s as its type, as a download', (name, type, file) => {
    expect(downloadOverrides(key(name))).toEqual({
      ResponseContentType: type,
      ResponseContentDisposition: `attachment; filename="${file}"`,
    });
  });

  // The subtype's last dot segment: the worker stored path.extname of the key.
  it.each([
    ['original.plain', 'text/plain; charset=utf-8', 'file.txt'],
    ['original.msword', 'application/msword', 'file.doc'],
    ['original.ms-excel', 'application/vnd.ms-excel', 'file.xls'],
    [
      'original.document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'file.docx',
    ],
    [
      'original.sheet',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'file.xlsx',
    ],
    [
      'original.presentation',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'file.pptx',
    ],
    ['original.ms-powerpoint', 'application/vnd.ms-powerpoint', 'file.ppt'],
    ['original.x-rar-compressed', 'application/x-rar-compressed', 'file.rar'],
  ])('serves a key from before 5 Aug, %s, the same way', (name, type, file) => {
    expect(downloadOverrides(key(name))).toEqual({
      ResponseContentType: type,
      ResponseContentDisposition: `attachment; filename="${file}"`,
    });
  });

  it.each([
    'original.html',
    'original.bin',
    'original.constructor',
    'original.txt"; filename="x.html',
    'original',
    'notes.txt',
  ])('serves an unknown %s as bytes, as a download, under a generic name', (name) => {
    expect(downloadOverrides(key(name))).toEqual({
      ResponseContentType: 'application/octet-stream',
      ResponseContentDisposition: 'attachment; filename="file"',
    });
  });

  it('leaves images, video and voice alone, which have to stay inline', () => {
    expect(downloadOverrides('dm-image/u/id/original.webp')).toEqual({});
    expect(downloadOverrides('dm-video/u/id/original.mp4')).toEqual({});
    expect(downloadOverrides('dm-audio/u/id/original.ogg')).toEqual({});
  });

  it('knows every type dm-file accepts today, by its own extension', () => {
    for (const mimeType of CONTEXT_CONFIG['dm-file'].allowedMimes) {
      const name = `original.${extensionOf(mimeType)}`;
      expect(downloadOverrides(key(name)).ResponseContentType).toBe(
        contentTypeFor(mimeType),
      );
    }
  });
});

describe('extensionOf', () => {
  it('reads only its own table', () => {
    expect(extensionOf('application/pdf')).toBe('pdf');
    expect(extensionOf('constructor')).toBeUndefined();
    expect(extensionOf('__proto__')).toBeUndefined();
  });
});

describe('attachmentFor', () => {
  it('names the file by its type only', () => {
    expect(attachmentFor('text/plain')).toBe('attachment; filename="file.txt"');
    expect(attachmentFor(undefined)).toBe('attachment; filename="file"');
  });
});
