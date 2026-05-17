export type UploadContext =
  | 'avatar'
  | 'group-avatar'
  | 'cover-photo'
  | 'dm-image'
  | 'dm-video'
  | 'dm-file'
  | 'dm-audio'
  | 'post-image'
  | 'post-video'
  | 'story-image'
  | 'story-video';

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
