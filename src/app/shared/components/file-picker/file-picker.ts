import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  FileUploadService,
  UploadContext,
  UploadState,
} from '../../services/file-upload.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface FilePickerConfig {
  /** Drives allowed types and UI copy */
  context: UploadContext;
  allowedMimeTypes?: string[];
  maxSizeMb?: number;
  /** e.g. 'image/*,.pdf' — overrides auto-derived value if set */
  acceptAttr?: string;
}

export interface FileReadyEvent {
  file: File;
  fileKey: string;
  previewUrl: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-file-picker',
  template: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilePicker implements OnDestroy {
  // ── Inputs ────────────────────────────────────────────────────────────────

  config = input.required<FilePickerConfig>();

  // ── Outputs ───────────────────────────────────────────────────────────────

  /**
   * Fires when file has been uploaded to staging (status = 'scanning').
   * Chat: parent holds fileKey, emits confirm() on Send.
   * Avatar: parent calls confirm() immediately.
   */
  fileReady = output<FileReadyEvent>();

  /** Fires on clear — parent should discard fileKey if not yet confirmed. */
  cleared = output<void>();

  // ── State ─────────────────────────────────────────────────────────────────

  readonly uploadState = signal<UploadState | null>(null);
  readonly validationError = signal<string | null>(null);
  readonly isDragOver = signal(false);
  readonly previewUrl = signal<string | null>(null);

  private selectedFile = signal<File | null>(null);
  private uploadSub: Subscription | null = null;

  // ── Derived ───────────────────────────────────────────────────────────────

  readonly progress = computed(() => this.uploadState()?.progress ?? 0);

  readonly isIdle = computed(() => !this.selectedFile());
  readonly isUploading = computed(
    () => this.uploadState()?.status === 'uploading',
  );
  readonly isScanning = computed(
    () => this.uploadState()?.status === 'scanning',
  );
  readonly isDone = computed(() => this.uploadState()?.status === 'clean');
  readonly isInfected = computed(
    () => this.uploadState()?.status === 'infected',
  );
  readonly isError = computed(() => this.uploadState()?.status === 'error');

  readonly canClear = computed(() => {
    const s = this.uploadState()?.status;
    return s === 'clean' || s === 'infected' || s === 'error';
  });

  // resolvedAccept
  readonly resolvedAccept = computed(() => {
    if (this.config().acceptAttr) return this.config().acceptAttr!;
    const types =
      this.config().allowedMimeTypes ?? defaultAllowed(this.config().context);
    return types ? types.join(',') : '*/*';
  });

  readonly triggerLabel = computed(() => {
    const mode = this.config().context.mode;
    if (mode === 'avatar') return 'Upload profile picture';
    if (mode === 'document') return 'Attach document';
    return 'Attach file';
  });

  // ── DI ────────────────────────────────────────────────────────────────────

  private readonly uploadService = inject(FileUploadService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Handlers ─────────────────────────────────────────────────────────────

  onInputChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.processFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.processFile(file);
  }

  retry(): void {
    const file = this.selectedFile();
    if (file) this.startUpload(file);
  }

  clear(): void {
    this.uploadSub?.unsubscribe();
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

  /**
   * Called by parent when WebSocket delivers the final scan result.
   * Drives badge update without the component knowing about WS directly.
   */
  applyWsStatus(state: Pick<UploadState, 'status' | 'error'>): void {
    this.uploadState.update((prev) =>
      prev
        ? { ...prev, ...state }
        : { status: state.status, progress: 100, error: state.error },
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnDestroy(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async processFile(file: File): Promise<void> {
    const cfg = this.config();
    const maxBytes = (cfg.maxSizeMb ?? 10) * 1024 * 1024;
    // processFile — skip type check when null
    const allowed =
      this.config().allowedMimeTypes ?? defaultAllowed(this.config().context);

    const error = await this.uploadService.validate(file, allowed, maxBytes);

    if (error) {
      this.validationError.set(error);
      return;
    }

    this.validationError.set(null);
    this.selectedFile.set(file);

    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      this.previewUrl.set(URL.createObjectURL(file));
    }

    this.startUpload(file);
  }

  private startUpload(file: File): void {
    this.uploadSub?.unsubscribe();
    this.uploadState.set({ status: 'uploading', progress: 0 });

    this.uploadSub = this.uploadService
      .upload(file, this.config().context)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          this.uploadState.set(state);

          // Notify parent the file is staged — they decide when to confirm()
          if (state.status === 'scanning' && state.fileKey) {
            this.fileReady.emit({
              file,
              fileKey: state.fileKey,
              previewUrl: this.previewUrl(),
            });
          }
        },
        error: (errState: UploadState) => {
          this.uploadState.set(errState);
        },
      });
  }
}

// Replace defaultAllowed entirely
function defaultAllowed(ctx: UploadContext): string[] | null {
  switch (ctx.mode) {
    case 'avatar':
      return ['image/jpeg', 'image/png', 'image/webp'];
    case 'document':
      return ['application/pdf'];
    case 'chat':
    default:
      return null; // null = accept anything
  }
}
