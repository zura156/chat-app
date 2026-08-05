import { UploadContext } from '../upload/upload.types';
import config from './config';

const MB = 1024 * 1024;

interface ContextConfig {
  allowedMimes: string[];
  maxBytes: number;
  bucket: string;
  expiresIn: number; // seconds
}

/*
 * Only contexts the app can actually attach an upload to.
 *
 * `post-image`, `post-video`, `story-image` and `story-video` were listed here
 * for features that do not exist. `presign` accepts any context present in this
 * map and validates a target resource only for group avatars, so they were a
 * standing grant of free storage — up to a gigabyte per call for `post-video` —
 * with nothing that could ever reference the result.
 */
export const CONTEXT_CONFIG: Record<UploadContext, ContextConfig> = {
  avatar: {
    allowedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ],
    maxBytes: 20 * MB,
    bucket: config.s3TempBucket,
    expiresIn: 300,
  },
  'group-avatar': {
    allowedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ],
    maxBytes: 20 * MB,
    bucket: config.s3TempBucket!,
    expiresIn: 300,
  },
  'cover-photo': {
    allowedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ],
    maxBytes: 20 * MB,
    bucket: config.s3TempBucket!,
    expiresIn: 300,
  },
  'dm-image': {
    allowedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
    ],
    maxBytes: 50 * MB,
    bucket: config.s3TempBucket!,
    expiresIn: 600,
  },
  'dm-video': {
    allowedMimes: [
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-msvideo',
      'video/x-matroska',
    ],
    maxBytes: 500 * MB,
    bucket: config.s3TempBucket!,
    expiresIn: 1800,
  },
  'dm-audio': {
    allowedMimes: [
      'audio/webm',
      'audio/ogg',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
    ],
    maxBytes: 25 * MB,
    bucket: config.s3TempBucket,
    expiresIn: 600,
  },
  'dm-file': {
    allowedMimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'application/zip',
      'application/x-7z-compressed',
      'application/x-rar-compressed',
    ],
    maxBytes: 100 * MB,
    bucket: config.s3TempBucket,
    expiresIn: 600,
  },
};
