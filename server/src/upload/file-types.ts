import type { GetObjectCommandInput } from '@aws-sdk/client-s3';
import path from 'path';
import { CONTEXT_CONFIG } from '../config/upload.config';

/**
 * File extension for a stored object. Deriving it from the mime subtype gave
 * keys like `original.vnd.openxmlformats-officedocument.wordprocessingml.document`
 * for anything but plain image and video types.
 */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'audio/webm': 'weba',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/x-7z-compressed': '7z',
  'application/x-rar-compressed': 'rar',
};

/** The extension for a known type. Own keys only: the type can come from a
 * request, and `EXTENSIONS['constructor']` would otherwise be a function. */
export const extensionOf = (mimeType: string): string | undefined =>
  Object.hasOwn(EXTENSIONS, mimeType) ? EXTENSIONS[mimeType] : undefined;

/** The stored and served type. Text is held to UTF-8 by the worker's signature
 * check (utils/file-signature.ts), so the charset is true. */
export const contentTypeFor = (mimeType: string): string =>
  mimeType.startsWith('text/') ? `${mimeType}; charset=utf-8` : mimeType;

/**
 * A download disposition. `filename` is always generic, so nothing the user
 * wrote is ever quoted into a header. With the sender's name for the file,
 * `filename*` adds it, percent-encoded (RFC 5987), which can't break out of
 * the header whatever it holds. Browsers prefer `filename*` (RFC 6266).
 */
export const attachmentFor = (
  mimeType: string | undefined,
  originalName?: string,
): string => {
  const extension = mimeType && extensionOf(mimeType);
  if (!extension) return 'attachment; filename="file"';

  const generic = `attachment; filename="file.${extension}"`;
  const name = originalName && downloadName(originalName, extension);
  return name ? `${generic}; filename*=UTF-8''${encodeRfc5987(name)}` : generic;
};

// Control and invisible format characters (a right-to-left override makes
// "invoice\u202Efdp.exe" read as "invoiceexe.pdf") and the characters
// Windows refuses in a file name.
const UNSAFE_IN_NAME = /[\p{Cc}\p{Cf}:*?"<>|]/gu;
const MAX_NAME_CHARACTERS = 100;

/**
 * The sender's name for the file, with the server's extension in place of
 * theirs: the extension is what a desktop opens a file with, so "invoice.js"
 * holding text has to arrive as "invoice.txt", not as a script Windows runs.
 * Undefined when nothing usable is left.
 */
export const downloadName = (
  originalName: string,
  extension: string,
): string | undefined => {
  // A name with a path in it (C:\Users\me\cv.docx) means its last part.
  const base = originalName.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/\s+/g, ' ') // before the controls go, so a tab still parts words
    .replace(UNSAFE_IN_NAME, '')
    .replace(/ {2,}/g, ' ');
  const stem = path.parse(cleaned).name.replace(/^[\s.]+|[\s.]+$/g, '');
  const short = Array.from(stem).slice(0, MAX_NAME_CHARACTERS).join('').trim();
  return short ? `${short}.${extension}` : undefined;
};

// encodeURIComponent leaves ' ( ) * as they are; RFC 5987 doesn't allow them.
const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// dm-file types by the extension in their stored key: today's, and the one
// keys carried before 5 Aug 2026. Presign then used the mime subtype, and the
// worker kept only its last dot segment (path.extname), so a .docx was stored
// as `original.document` and a .xls as `original.ms-excel`.
const DM_FILE_BY_EXTENSION = new Map<string, string>(
  CONTEXT_CONFIG['dm-file'].allowedMimes.flatMap((mimeType) => [
    [extensionOf(mimeType) ?? mimeType, mimeType],
    [path.extname(`original.${mimeType.split('/')[1]}`).slice(1), mimeType],
  ]),
);

/**
 * What a signed GET forces onto a private object (SECURITY-FIXES.md 2.3c).
 * A dm-file is served with the server's type and as a download whatever its
 * stored headers say: files stored before 2.3c kept the Content-Type their
 * client's PUT sent. The overrides are part of the signature, so a client
 * can't drop them. Other contexts are re-encoded by the worker, which sets
 * their type, and an image or a video has to stay inline. `originalName` is
 * the sender's name for the file, from the message (attachmentFor).
 */
export const downloadOverrides = (
  key: string,
  originalName?: string,
): Pick<
  GetObjectCommandInput,
  'ResponseContentType' | 'ResponseContentDisposition'
> => {
  if (!key.startsWith('dm-file/')) return {};

  // Exactly what follows `original.`, so a name the API didn't build, or one
  // with more after its extension, is never read as a known type.
  const name = key.slice(key.lastIndexOf('/') + 1);
  const extension = name.startsWith('original.')
    ? name.slice('original.'.length)
    : '';
  const mimeType = DM_FILE_BY_EXTENSION.get(extension);

  return {
    ResponseContentType: mimeType
      ? contentTypeFor(mimeType)
      : 'application/octet-stream',
    ResponseContentDisposition: attachmentFor(mimeType, originalName),
  };
};
