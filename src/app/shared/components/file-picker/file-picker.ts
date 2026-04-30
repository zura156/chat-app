import {
  ChangeDetectionStrategy,
  Component,
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
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="file-picker"
      [class.drag-over]="isDragOver()"
      [attr.data-status]="uploadState()?.status ?? 'idle'"
      (dragover)="onDragOver($event)"
      (dragleave)="isDragOver.set(false)"
      (drop)="onDrop($event)"
    >
      <!-- Hidden native file input -->
      <input
        #fileInput
        type="file"
        [accept]="resolvedAccept()"
        (change)="onInputChange($event)"
        style="display:none"
        aria-hidden="true"
      />

      <!-- Trigger slot — host provides the button/icon -->
      @if (isIdle()) {
        <button
          type="button"
          class="trigger-slot"
          (click)="fileInput.click()"
          [attr.aria-label]="triggerLabel()"
        >
          <ng-content select="[fileTrigger]"> 📎 </ng-content>
        </button>
      }

      <!-- Validation error -->
      @if (validationError()) {
        <span class="fp-error" role="alert">{{ validationError() }}</span>
      }

      <!-- Upload in progress -->
      @if (isUploading()) {
        <div
          class="fp-progress"
          role="progressbar"
          [attr.aria-valuenow]="progress()"
        >
          <div class="fp-progress__fill" [style.width.%]="progress()"></div>
          <span class="fp-progress__label">{{ progress() }}%</span>
        </div>
      }

      <!-- Scanning badge -->
      @if (isScanning()) {
        <span class="fp-badge fp-badge--scanning" aria-live="polite">
          Scanning…
        </span>
      }

      <!-- Image preview (chat / avatar) -->
      @if (previewUrl() && !isError() && !isInfected()) {
        <img
          class="fp-preview"
          [src]="previewUrl()"
          alt="File preview"
          loading="lazy"
        />
      }

      <!-- Done -->
      @if (isDone()) {
        <span class="fp-badge fp-badge--done" aria-live="polite">✓</span>
      }

      <!-- Infected -->
      @if (isInfected()) {
        <span class="fp-badge fp-badge--infected" role="alert">
          Removed — failed security scan
        </span>
      }

      <!-- Error -->
      @if (isError()) {
        <span class="fp-badge fp-badge--error" role="alert">
          {{ uploadState()?.error ?? 'Upload failed' }}
        </span>
        <button type="button" class="fp-retry" (click)="retry()">Retry</button>
      }

      <!-- Clear (after terminal state) -->
      @if (canClear()) {
        <button
          type="button"
          class="fp-clear"
          aria-label="Remove file"
          (click)="clear()"
        >
          ×
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .file-picker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        position: relative;
      }

      .file-picker.drag-over {
        outline: 2px dashed currentColor;
        border-radius: 4px;
      }

      .trigger-slot {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
      }

      .fp-progress {
        width: 120px;
        height: 4px;
        background: #e0e0e0;
        border-radius: 2px;
        overflow: hidden;
        position: relative;
      }
      .fp-progress__fill {
        height: 100%;
        background: #1976d2;
        transition: width 0.1s linear;
      }
      .fp-progress__label {
        position: absolute;
        top: 6px;
        left: 0;
        font-size: 11px;
        color: #666;
      }

      .fp-badge {
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .fp-badge--scanning {
        background: #fff3cd;
        color: #856404;
      }
      .fp-badge--done {
        background: #d4edda;
        color: #155724;
      }
      .fp-badge--infected {
        background: #f8d7da;
        color: #721c24;
      }
      .fp-badge--error {
        background: #f8d7da;
        color: #721c24;
      }

      .fp-preview {
        width: 40px;
        height: 40px;
        object-fit: cover;
        border-radius: 4px;
        border: 1px solid #ddd;
      }

      .fp-retry,
      .fp-clear {
        background: none;
        border: 1px solid currentColor;
        border-radius: 4px;
        cursor: pointer;
        padding: 2px 8px;
        font-size: 12px;
      }
      .fp-clear {
        border: none;
        font-size: 16px;
        line-height: 1;
        color: #666;
      }
    `,
  ],
})
export class FilePickerComponent implements OnDestroy {
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

  readonly resolvedAccept = computed(() => {
    if (this.config().acceptAttr) return this.config().acceptAttr!;
    return (
      this.config().allowedMimeTypes ?? defaultAllowed(this.config().context)
    ).join(',');
  });

  readonly triggerLabel = computed(() => {
    const mode = this.config().context.mode;
    if (mode === 'avatar') return 'Upload profile picture';
    if (mode === 'document') return 'Attach document';
    return 'Attach file';
  });

  // ── DI ────────────────────────────────────────────────────────────────────

  private readonly uploadService = inject(FileUploadService);

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
    this.uploadSub?.unsubscribe();
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async processFile(file: File): Promise<void> {
    const cfg = this.config();
    const maxBytes = (cfg.maxSizeMb ?? 10) * 1024 * 1024;
    const allowed = cfg.allowedMimeTypes ?? defaultAllowed(cfg.context);

    const error = await this.uploadService.validate(file, allowed, maxBytes);
    if (error) {
      this.validationError.set(error);
      return;
    }

    this.validationError.set(null);
    this.selectedFile.set(file);

    if (file.type.startsWith('image/')) {
      this.previewUrl.set(URL.createObjectURL(file));
    }

    this.startUpload(file);
  }

  private startUpload(file: File): void {
    this.uploadSub?.unsubscribe();
    this.uploadState.set({ status: 'uploading', progress: 0 });

    this.uploadSub = this.uploadService
      .upload(file, this.config().context)
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultAllowed(ctx: UploadContext): string[] {
  switch (ctx.mode) {
    case 'avatar':
      return ['image/jpeg', 'image/png', 'image/webp'];
    case 'document':
      return ['application/pdf', 'image/jpeg', 'image/png'];
    case 'chat':
    default:
      return [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
      ];
  }
}
