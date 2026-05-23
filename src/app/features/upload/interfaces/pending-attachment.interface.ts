import { UploadContext } from './upload.interface';

export interface PendingAttachment {
  tempId: string;
  file: File;
  fileKey: string | null; // null while uploading
  previewUrl: string | null;
  context: UploadContext;
  uploading: boolean;
  error: string | null;
}
