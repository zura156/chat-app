import { Injectable, signal, computed, inject } from '@angular/core';
import {
  HttpClient,
  HttpEventType,
  HttpHeaders,
  HttpRequest,
} from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

export interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'compressing' | 'uploading' | 'ready' | 'error';
  error?: string;
  key?: string;
  mimeType?: string;
  originalName?: string;
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

const LIMITS: Record<string, number> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  default: 25 * 1024 * 1024,
};
const MAX_FILES = 5;
const CONCURRENCY = 3;

function getLimit(mimeType: string): number {
  return LIMITS[mimeType.split('/')[0]] ?? LIMITS['default'];
}

async function compressImage(file: File, quality = 0.8): Promise<File> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const MAX_DIM = 4096;
  if (width > MAX_DIM || height > MAX_DIM) {
    const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
  return new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), {
    type: 'image/webp',
  });
}

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly API = '/api/upload';
  private readonly http = inject(HttpClient);

  // --- Public reactive state ---
  readonly files = signal<UploadFile[]>([]);
  readonly isBusy = computed(() =>
    this.files().some(
      (f) => f.status === 'compressing' || f.status === 'uploading',
    ),
  );
  readonly hasFiles = computed(() => this.files().length > 0);
  readonly readyFiles = computed(() =>
    this.files().filter((f) => f.status === 'ready'),
  );

  validate(incoming: File[]): string | null {
    if (this.files().length + incoming.length > MAX_FILES)
      return `Max ${MAX_FILES} files per message`;
    for (const f of incoming) {
      if (f.size > getLimit(f.type))
        return `${f.name} exceeds ${Math.round(getLimit(f.type) / 1024 / 1024)}MB limit`;
    }
    return null;
  }

  // Called on file pick — starts upload immediately in background
  async startUpload(rawFiles: File[]): Promise<void> {
    const error = this.validate(rawFiles);
    if (error) throw new Error(error);

    const uploadFiles: UploadFile[] = rawFiles.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      progress: 0,
      status: 'compressing',
    }));
    this.files.update((fs) => [...fs, ...uploadFiles]);

    // Compress images, skip compression for other types
    const compressed = await Promise.all(
      rawFiles.map((f, i) => {
        if (!f.type.startsWith('image/')) {
          this.patchFile(uploadFiles[i].id, { status: 'uploading' });
          return Promise.resolve(f);
        }
        return compressImage(f).then((result) => {
          this.patchFile(uploadFiles[i].id, { status: 'uploading' });
          return result;
        });
      }),
    );

    // Get presigned URLs from server
    let initRes: InitResponse;
    try {
      initRes = await lastValueFrom(
        this.http.post<InitResponse>(`${this.API}/init`, {
          files: compressed.map((f) => ({
            name: f.name,
            mimeType: f.type,
            size: f.size,
          })),
        }),
      );
    } catch {
      uploadFiles.forEach((uf) =>
        this.patchFile(uf.id, {
          status: 'error',
          error: 'Server error. Try again.',
        }),
      );
      return;
    }

    // Upload to MinIO (max CONCURRENCY at a time)
    for (let i = 0; i < compressed.length; i += CONCURRENCY) {
      await Promise.all(
        compressed
          .slice(i, i + CONCURRENCY)
          .map((file, idx) =>
            this.uploadToStorage(
              uploadFiles[i + idx],
              file,
              initRes.files[i + idx],
            ),
          ),
      );
    }
  }

  // Called on send — waits for uploads then confirms with server
  async confirmAndSend(): Promise<ConfirmResponse['files']> {
    // Zoneless-safe: await a Promise that resolves when isBusy flips to false
    // using a microtask loop instead of setInterval (which doesn't trigger CD in zoneless)
    await this.waitForUploads();

    const ready = this.readyFiles();
    if (!ready.length) throw new Error('No files ready to send');

    const confirmRes = await lastValueFrom(
      this.http.post<ConfirmResponse>(`${this.API}/confirm`, {
        files: ready.map((f) => ({
          key: f.key,
          originalName: f.originalName,
          mimeType: f.mimeType,
          size: f.file.size,
        })),
      }),
    );

    return (confirmRes as any).files;
  }

  remove(id: string): void {
    this.files.update((fs) => fs.filter((f) => f.id !== id));
  }

  reset(): void {
    this.files.set([]);
  }

  // --- Private ---

  // Zoneless-safe busy wait: uses Promise chaining off the actual upload Promises
  // This is a simple polling fallback — in a real app you'd track the upload
  // Promises directly and await Promise.all() on them instead.
  private waitForUploads(): Promise<void> {
    const poll = (resolve: () => void) => {
      if (!this.isBusy()) {
        resolve();
        return;
      }
      // Use Promise.resolve() microtask loop — doesn't need zone.js
      Promise.resolve().then(() => setTimeout(() => poll(resolve), 100));
    };
    return new Promise(poll);
  }

  private patchFile(id: string, patch: Partial<UploadFile>): void {
    this.files.update((fs) =>
      fs.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  }

  private uploadToStorage(
    uploadFile: UploadFile,
    file: File,
    meta: {
      key: string;
      uploadUrl: string;
      originalName: string;
      mimeType: string;
    },
  ): Promise<void> {
    return new Promise((resolve) => {
      const req = new HttpRequest('PUT', meta.uploadUrl, file, {
        headers: new HttpHeaders({ 'Content-Type': file.type }),
        reportProgress: true,
      });

      this.http.request(req).subscribe({
        next: (event: any) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.patchFile(uploadFile.id, {
              progress: Math.round((100 * event.loaded) / event.total),
            });
          } else if (event.type === HttpEventType.Response) {
            this.patchFile(uploadFile.id, {
              status: 'ready',
              progress: 100,
              key: meta.key,
              mimeType: meta.mimeType,
              originalName: meta.originalName,
            });
            resolve();
          }
        },
        error: (err: any) => {
          this.patchFile(uploadFile.id, {
            status: 'error',
            error: err.message,
          });
          resolve(); // don't block other uploads
        },
      });
    });
  }
}
