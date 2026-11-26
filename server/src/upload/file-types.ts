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

/** Always a generic name: nothing the user wrote goes into a header. */
export const attachmentFor = (mimeType: string | undefined): string => {
  const extension = mimeType && extensionOf(mimeType);
  return extension
    ? `attachment; filename="file.${extension}"`
    : 'attachment; filename="file"';
};

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
 * their type, and an image or a video has to stay inline.
 */
export const downloadOverrides = (
  key: string,
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
    ResponseContentDisposition: attachmentFor(mimeType),
  };
};
