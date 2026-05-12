export type UploadContext =
  | 'avatar'
  | 'group-avatar'
  | 'cover-photo'
  | 'dm-image'
  | 'dm-video'
  | 'dm-file'
  | 'post-image'
  | 'post-video'
  | 'story-image'
  | 'story-video';

export interface PresignRequest {
  context: UploadContext;
  mimeType: string;
  fileSize: number;
  resourceId?: string; // groupId, postId, etc.
}
