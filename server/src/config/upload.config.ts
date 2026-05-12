import { UploadContext } from '../upload/upload.types';
import config from './config';

const MB = 1024 * 1024;

interface ContextConfig {
  allowedMimes: string[];
  maxBytes: number;
  bucket: string;
  expiresIn: number; // seconds
}

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
    bucket: config.s3PublicBucket,
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
    bucket: config.s3PublicBucket!,
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
    bucket: config.s3PublicBucket!,
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
  'post-image': {
    allowedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ],
    maxBytes: 50 * MB,
    bucket: config.s3TempBucket,
    expiresIn: 600,
  },
  'post-video': {
    allowedMimes: [
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-msvideo',
    ],
    maxBytes: 1024 * MB,
    bucket: config.s3TempBucket,
    expiresIn: 3600,
  },
  'story-image': {
    allowedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ],
    maxBytes: 50 * MB,
    bucket: config.s3TempBucket!,
    expiresIn: 600,
  },
  'story-video': {
    allowedMimes: ['video/mp4', 'video/quicktime', 'video/webm'],
    maxBytes: 200 * MB,
    bucket: config.s3TempBucket!,
    expiresIn: 1800,
  },
};
