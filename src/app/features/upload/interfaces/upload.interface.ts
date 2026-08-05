/**
 * Must match CONTEXT_CONFIG on the server (config/upload.config.ts). The
 * post-* and story-* contexts were dropped from both: they described features
 * that do not exist, and the server accepted presign requests for them.
 */
export type UploadContext =
  | 'avatar'
  | 'group-avatar'
  | 'cover-photo'
  | 'dm-image'
  | 'dm-video'
  | 'dm-file'
  | 'dm-audio';

export interface PresignResponse {
  uploadId: string;
  presignedUrl: string;
  fileKey: string;
  expiresIn: number;
}

export interface UploadState {
  uploadId: string;
  progress: number; // 0-100
  status: 'idle' | 'uploading' | 'confirming' | 'done' | 'error';
  error?: string;
}
