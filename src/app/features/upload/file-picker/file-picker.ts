import {
  Component,
  DestroyRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Subject, Subscription, takeUntil } from 'rxjs';
import {
  UploadContext,
  UploadState,
} from '../../../features/upload/interfaces/upload.interface';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UploadService } from '../../../features/upload/services/upload.service';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface FilePickerConfig {
  /** Drives allowed types and UI copy */
  context: UploadContext;
  allowedMimeTypes?: string[];
  maxSizeMb?: number;
  /** e.g. 'image/*,.pdf' — overrides auto-derived value if set */
  acceptAttr?: string;
}

export interface FileSelectedEvent {
  tempId: string;
  file: File;
  previewUrl: string | null;
}

export interface FileReadyEvent {
  tempId: string; // add this
  file: File;
  fileKey: string;
  previewUrl: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-file-picker',
  template: `<ng-content />`,
})
export class FilePicker implements OnDestroy {
  config = input.required<FilePickerConfig>();
  remainingSlots = input<number>(Infinity);

  fileReady = output<FileReadyEvent>();
  cleared = output<void>();
  fileSelected = output<FileSelectedEvent>();
  fileError = output<{ tempId: string; error: string }>();

  readonly uploadState = signal<UploadState | null>(null);
  readonly validationError = signal<string | null>(null);
  readonly isDragOver = signal(false);
  readonly previewUrl = signal<string | null>(null);

  readonly progress = computed(() => this.uploadState()?.progress ?? 0);
  readonly isUploading = computed(
    () => this.uploadState()?.status === 'uploading',
  );
  readonly isConfirming = computed(
    () => this.uploadState()?.status === 'confirming',
  );
  readonly isDone = computed(() => this.uploadState()?.status === 'done');
  readonly isError = computed(() => this.uploadState()?.status === 'error');

  readonly resolvedAccept = computed(() => {
    if (this.config().acceptAttr) return this.config().acceptAttr!;
    const types =
      this.config().allowedMimeTypes ?? defaultAllowed(this.config().context);
    return types ? types.join(',') : '*/*';
  });

  private selectedFile = signal<File | null>(null);

  private inputRef = signal<HTMLInputElement | null>(null);

  private readonly uploadService = inject(UploadService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cancelAll$ = new Subject<void>();

  contextResolver = input<((file: File) => UploadContext) | null>(null);

  triggerInput(): void {
    this.inputRef()?.click();
  }

  onInputChange(event: Event): void {
    const files = Array.from(
      (event.target as HTMLInputElement).files ?? [],
    ).slice(0, this.remainingSlots());
    files.forEach((file) => this.processFile(file));
    (event.target as HTMLInputElement).value = ''; // reset so same file can be re-selected
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    files.forEach((file) => this.processFile(file));
  }

  clear(): void {
    this.cancelAll$.next();

    this.selectedFile.set(null);
    this.uploadState.set(null);
    this.validationError.set(null);
    const url = this.previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
      this.previewUrl.set(null);
    }
    this.cleared.emit();
  }

  ngOnDestroy(): void {
    this.cancelAll$.next();
    this.cancelAll$.complete();
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
  }

  public processFile(file: File): void {
    const cfg = this.config();
    const maxBytes = (cfg.maxSizeMb ?? 50) * 1024 * 1024;
    const allowed = cfg.allowedMimeTypes ?? defaultAllowed(cfg.context);

    if (allowed && allowed.length > 0 && !allowed.includes(file.type)) {
      this.validationError.set(`File type ${file.type} not allowed.`);
      return;
    }

    if (file.size > maxBytes) {
      this.validationError.set(`File exceeds ${cfg.maxSizeMb ?? 50}MB limit.`);
      return;
    }

    this.validationError.set(null);
    this.selectedFile.set(file);

    const isPreviewable =
      file.type.startsWith('image/') &&
      !['image/heic', 'image/heif'].includes(file.type);

    const previewUrl = isPreviewable ? URL.createObjectURL(file) : null;

    const tempId = crypto.randomUUID();
    this.fileSelected.emit({ tempId, file, previewUrl });
    this.startUpload(file, tempId, previewUrl);
  }

  private startUpload(
    file: File,
    tempId: string,
    previewUrl: string | null,
  ): void {
    const context = this.contextResolver()?.(file) ?? this.config().context;

    this.uploadService
      .uploadFile(context, file)
      .pipe(takeUntil(this.cancelAll$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (uploadId) => {
          this.fileReady.emit({
            tempId,
            file,
            fileKey: uploadId,
            previewUrl,
          });
        },
        error: (err) => {
          this.fileError.emit({
            tempId,
            error: err.message ?? 'Upload failed',
          });
          this.uploadState.set({
            uploadId: '',
            progress: 0,
            status: 'error',
            error: err.message,
          });
        },
      });
  }
}

function defaultAllowed(ctx: UploadContext): string[] | null {
  switch (ctx) {
    case 'avatar':
    case 'group-avatar':
    case 'cover-photo':
    case 'post-image':
    case 'story-image':
      return [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
      ];
    case 'dm-image':
      return [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/heic',
        'image/heif',
      ];
    case 'dm-video':
      return [
        'video/mp4',
        'video/quicktime',
        'video/webm',
        'video/x-msvideo',
        'video/x-matroska',
      ];
    case 'post-video':
      return ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
    case 'story-video':
      return ['video/mp4', 'video/quicktime', 'video/webm'];
    case 'dm-audio':
      return [
        'audio/webm',
        'audio/ogg',
        'audio/mp4',
        'audio/mpeg',
        'audio/wav',
      ];
    case 'dm-file':
      return [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/csv',
        'application/zip',
        'application/x-7z-compressed',
        'application/x-rar-compressed',
      ];
    default:
      return null;
  }
}
