import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import {
  Observable,
  switchMap,
  map,
  catchError,
  throwError,
  filter,
} from 'rxjs';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UploadStatus =
  | 'idle'
  | 'uploading'
  | 'scanning'
  | 'clean'
  | 'infected'
  | 'error';

export interface UploadState {
  status: UploadStatus;
  progress: number; // 0–100
  fileKey?: string;
  error?: string;
}

export type UploadContext =
  | { mode: 'chat'; conversationId: string }
  | { mode: 'avatar' }
  | { mode: 'document' };

interface PresignedUrlResponse {
  uploadUrl: string;
  fileKey: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/gif': [[0x47, 0x49, 0x46]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
};

async function validateMagicBytes(file: File): Promise<boolean> {
  const signatures = MAGIC_BYTES[file.type];
  if (!signatures) return true; // unknown type — let server decide

  const buffer = await file.slice(0, 8).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  return signatures.some((sig) => sig.every((b, i) => bytes[i] === b));
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class FileUploadService {
  private readonly http = inject(HttpClient);

  /**
   * Validate file client-side (size, type, magic bytes).
   * Returns error string or null if valid.
   */
  async validate(
    file: File,
    allowedMimeTypes: string[] | null,
    maxSizeBytes: number,
  ): Promise<string | null> {
    if (file.size > maxSizeBytes) {
      return `Too large — max ${Math.round(maxSizeBytes / 1024 / 1024)} MB`;
    }
    if (allowedMimeTypes && !allowedMimeTypes.includes(file.type)) {
      return `Type not allowed`;
    }
    const magicOk = await validateMagicBytes(file);
    if (!magicOk) {
      return `File content doesn't match declared type`;
    }
    return null;
  }

  /**
   * Full upload pipeline:
   *   1. Request presigned URL from backend
   *   2. PUT file directly to object storage
   *   3. Emits UploadState progress events
   *      — last emission has status 'scanning' + fileKey when S3 PUT completes
   *
   * Caller is responsible for calling confirm() when ready (e.g. on Send).
   */
  upload(file: File, ctx: UploadContext): Observable<UploadState> {
    return this.http
      .post<PresignedUrlResponse>('/api/upload/presign', {
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        context: ctx,
      })
      .pipe(
        switchMap(({ uploadUrl, fileKey }) =>
          this.http
            .put(uploadUrl, file, {
              headers: { 'Content-Type': file.type },
              reportProgress: true,
              observe: 'events',
            })
            .pipe(
              map((event): UploadState => {
                if (event.type === HttpEventType.UploadProgress) {
                  const progress = event.total
                    ? Math.round((100 * event.loaded) / event.total)
                    : 0;
                  return { status: 'uploading', progress, fileKey };
                }
                if (event.type === HttpEventType.Response) {
                  return { status: 'scanning', progress: 100, fileKey };
                }
                return { status: 'uploading', progress: 0, fileKey };
              }),
              filter(Boolean),
            ),
        ),
        catchError((err) =>
          throwError(
            (): UploadState => ({
              status: 'error',
              progress: 0,
              error: err?.error?.message ?? err?.message ?? 'Upload failed',
            }),
          ),
        ),
      );
  }
}
