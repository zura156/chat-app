export const BUCKET = process.env.MINIO_BUCKET ?? 'messenger';

export const MAX_FILES_PER_MESSAGE = 5;

export const SIZE_LIMITS: Record<string, number> = {
  image: 10 * 1024 * 1024, // 10MB
  video: 50 * 1024 * 1024, // 50MB
  application: 25 * 1024 * 1024, // 25MB
  default: 25 * 1024 * 1024, // 25MB
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
