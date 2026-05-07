import config from './config';

export const PUBLIC_BUCKET = config.s3PublicBucket;
export const PRIVATE_BUCKET = config.s3PrivateBucket;
export const HLS_BUCKET = config.s3HlsBucket;
export const TEMP_BUCKET = config.s3TempBucket;
export const QUARANTINE_BUCKET = config.s3QuarantineBucket;

export type ScanStatus = 'scanning' | 'clean' | 'infected' | 'error';
export type UploadContext =
  | 'avatar'
  | 'group-avatar'
  | 'cover-photo'
  | 'dm-image'
  | 'dm-video'
  | 'dm-file'
  | 'post-image'
  | 'post-video'
  | 'story';

export interface UploadJobData {
  fileId: string;
  key: string; // quarantine key: uploads/{userId}/{fileId}/{filename}
  userId: string;
  context: UploadContext;
  mimeType: string;
  originalName: string;
  size: number;
}

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
