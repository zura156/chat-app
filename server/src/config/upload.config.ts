import config from './config';

export const TEMPORARY_BUCKET = config.s3StagingBucket;
export const PERMANENT_BUCKET = config.s3PermanentBucket;
export const QUARANTINE_BUCKET = config.s3QuarantineBucket;

export const MAX_FILES_PER_MESSAGE = 5;

export const SIZE_LIMITS: Record<string, number> = {
  image: 100 * 1024 * 1024, // 100MB
  video: 100 * 1024 * 1024, // 100MB
  application: 100 * 1024 * 1024, // 100MB
  default: 100 * 1024 * 1024, // 100MB
};

export const ALLOWED_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/',
  'text/',
];

export const PRESIGNED_PUT_EXPIRY = 60; // seconds
export const PRESIGNED_GET_EXPIRY = 7 * 24 * 60 * 60; // 7 days
