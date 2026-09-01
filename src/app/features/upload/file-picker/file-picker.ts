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
import { Subject, takeUntil } from 'rxjs';
import {
  UploadContext,
  UploadState,
} from '../../../features/upload/interfaces/upload.interface';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UploadService } from '../../../features/upload/services/upload.service';
import { apiErrorMessage } from '../../../shared/functions/api-error';

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

  /**
   * A host veto, consulted *before* the upload begins.
   *
   * The host's own checks — "already attached", "that's the eleventh" — used to
   * run in its `fileSelected` handler, which this component emits immediately
   * before calling `startUpload`. Returning early there stopped the file
   * becoming a chip but not the upload: it ran to completion, `fileReady` found
   * no attachment to hand the key to, and the stored object was orphaned.
   * Returning a string here refuses the file and reports the reason instead.
   */
  accept = input<((file: File) => string | null) | null>(null);

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
    // Sliced to the allowance, as onInputChange already was — dropping ten
    // files onto a composer with one slot left started ten uploads.
    const files = Array.from(event.dataTransfer?.files ?? []).slice(
      0,
      this.remainingSlots(),
    );
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
    // Resolve the context first: the limit depends on what is being uploaded,
    // and a flat 50MB default rejected videos the API would happily accept.
    const context = this.contextResolver()?.(file) ?? cfg.context;
    const maxMb = cfg.maxSizeMb ?? MAX_SIZE_MB[context] ?? 50;
    const maxBytes = maxMb * 1024 * 1024;
    const allowed = cfg.allowedMimeTypes ?? defaultAllowed(context);

    const fail = (message: string) => {
      this.validationError.set(message);
      // surface it to the host — the picker's own error signal is not rendered
      // by every consumer, so rejected files used to disappear silently
      this.fileError.emit({ tempId: crypto.randomUUID(), error: message });
    };

    if (allowed && allowed.length > 0 && !allowed.includes(file.type)) {
      fail(`File type ${file.type || 'unknown'} is not allowed.`);
      return;
    }

    if (file.size > maxBytes) {
      fail(`"${file.name}" exceeds the ${maxMb}MB limit.`);
      return;
    }

    const refusal = this.accept()?.(file);
    if (refusal) {
      fail(refusal);
      return;
    }

    this.validationError.set(null);
    this.selectedFile.set(file);

    const isPreviewable =
      (file.type.startsWith('image/') &&
        !['image/heic', 'image/heif'].includes(file.type)) ||
      file.type.startsWith('video/');

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
          // Was `err.message`, i.e. Angular's transport boilerplate rather than
          // the server's reason — see the note in UploadService.uploadFile.
          const message = apiErrorMessage(
            err,
            `"${file.name}" could not be uploaded.`,
          );

          this.fileError.emit({ tempId, error: message });
          this.uploadState.set({
            uploadId: '',
            progress: 0,
            status: 'error',
            error: message,
          });
        },
      });
  }
}

/**
 * Mirrors CONTEXT_CONFIG.maxBytes on the server (config/upload.config.ts).
 *
 * Exported because it was not the only client-side copy of these numbers, and
 * the copies disagreed. An avatar was capped at 5MB by the profile screen's own
 * check, described as 10MB by the config it passed to this picker, allowed up
 * to 20MB here, and accepted up to 20MB by the server — so a 7MB photo was
 * refused with "File size exceeds the 5MB limit" by an app that would have
 * taken it, and the number in the message was one no other layer agreed with.
 */
export const MAX_SIZE_MB: Partial<Record<UploadContext, number>> = {
  avatar: 20,
  'group-avatar': 20,
  'cover-photo': 20,
  'dm-image': 50,
  'dm-video': 500,
  'dm-audio': 25,
  'dm-file': 100,
};

function defaultAllowed(ctx: UploadContext): string[] | null {
  switch (ctx) {
    case 'avatar':
    case 'group-avatar':
    case 'cover-photo':
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
