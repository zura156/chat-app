import { Injectable, signal, computed } from '@angular/core';
import {
  HttpClient,
  HttpEventType,
  HttpRequest,
  HttpHeaders,
} from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

// --- Types ---
export interface UploadFile {
  id: string;
  file: File;
  progress: number; // 0-100
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  key?: string;
  url?: string;
}

interface InitResponse {
  files: {
    key: string;
    uploadUrl: string;
    originalName: string;
    mimeType: string;
  }[];
}

interface ConfirmResponse {
  files: { key: string; url: string; originalName: string; mimeType: string }[];
}

// --- Limits (mirror backend) ---
const LIMITS: Record<string, number> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  default: 25 * 1024 * 1024,
};
const MAX_FILES = 5;

function getLimit(mimeType: string): number {
  const prefix = mimeType.split('/')[0];
  return LIMITS[prefix] ?? LIMITS['default'];
}

function compressImage(file: File, quality = 0.8): Promise<File> {
  return new Promise((resolve, reject) => {
    createImageBitmap(file)
      .then((bitmap) => {
        let { width, height } = bitmap;
        // Downscale if too large
        const MAX_DIM = 4096;
        if (width > MAX_DIM || height > MAX_DIM) {
          const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0, width, height);
        canvas
          .convertToBlob({ type: 'image/webp', quality })
          .then((blob) => {
            const compressed = new File(
              [blob],
              file.name.replace(/\.[^.]+$/, '.webp'),
              { type: 'image/webp' },
            );
            resolve(compressed);
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly API = '/api/upload';

  // Reactive state using signals
  readonly files = signal<UploadFile[]>([]);
  readonly isUploading = computed(() =>
    this.files().some((f) => f.status === 'uploading'),
  );
  readonly allDone = computed(() =>
    this.files().every((f) => f.status === 'done' || f.status === 'error'),
  );

  constructor(private http: HttpClient) {}

  // --- Validate files client-side before anything ---
  validate(files: File[]): string | null {
    if (files.length > MAX_FILES) return `Max ${MAX_FILES} files per message`;
    for (const file of files) {
      const limit = getLimit(file.type);
      if (file.size > limit) {
        return `${file.name} exceeds ${Math.round(limit / 1024 / 1024)}MB limit`;
      }
    }
    return null;
  }

  // --- Main upload flow ---
  async upload(rawFiles: File[]): Promise<ConfirmResponse['files']> {
    const error = this.validate(rawFiles);
    if (error) throw new Error(error);

    // 1. Compress images
    const files = await Promise.all(
      rawFiles.map((f) =>
        f.type.startsWith('image/') ? compressImage(f) : Promise.resolve(f),
      ),
    );

    // 2. Init signals state
    const uploadFiles: UploadFile[] = files.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      progress: 0,
      status: 'pending',
    }));
    this.files.set(uploadFiles);

    // 3. Get presigned URLs from server (max 3 concurrent)
    const initRes = await lastValueFrom(
      this.http.post<InitResponse>(`${this.API}/init`, {
        files: files.map((f) => ({
          name: f.name,
          mimeType: f.type,
          size: f.size,
        })),
      }),
    );

    // 4. Upload directly to MinIO (max 3 concurrent)
    const CONCURRENCY = 3;
    const results: {
      key: string;
      originalName: string;
      mimeType: string;
      size: number;
    }[] = [];

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      const batchMeta = initRes.files.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map((file, idx) =>
          this.uploadToStorage(uploadFiles[i + idx], file, batchMeta[idx]),
        ),
      );

      results.push(
        ...batchMeta.map((meta, idx) => ({
          key: meta.key,
          originalName: meta.originalName,
          mimeType: meta.mimeType,
          size: batch[idx].size,
        })),
      );
    }

    // 5. Confirm with server
    const confirmRes = await lastValueFrom(
      this.http.post<ConfirmResponse>(`${this.API}/confirm`, {
        files: results,
      }),
    );

    return confirmRes.files;
  }

  private uploadToStorage(
    uploadFile: UploadFile,
    file: File,
    meta: { key: string; uploadUrl: string },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Update status
      this.files.update((fs) =>
        fs.map((f) =>
          f.id === uploadFile.id ? { ...f, status: 'uploading' } : f,
        ),
      );

      const req = new HttpRequest('PUT', meta.uploadUrl, file, {
        headers: new HttpHeaders({ 'Content-Type': file.type }),
        reportProgress: true,
      });

      this.http.request(req).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            const progress = Math.round((100 * event.loaded) / event.total);
            this.files.update((fs) =>
              fs.map((f) => (f.id === uploadFile.id ? { ...f, progress } : f)),
            );
          } else if (event.type === HttpEventType.Response) {
            this.files.update((fs) =>
              fs.map((f) =>
                f.id === uploadFile.id
                  ? { ...f, status: 'done', progress: 100, key: meta.key }
                  : f,
              ),
            );
            resolve();
          }
        },
        error: (err) => {
          this.files.update((fs) =>
            fs.map((f) =>
              f.id === uploadFile.id
                ? { ...f, status: 'error', error: err.message }
                : f,
            ),
          );
          reject(err);
        },
      });
    });
  }

  reset(): void {
    this.files.set([]);
  }
}
