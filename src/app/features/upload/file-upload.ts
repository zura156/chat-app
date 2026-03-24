import {
  Component,
  inject,
  signal,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { UploadService } from './upload.service';

@Component({
  selector: 'app-file-upload',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- File preview list -->
    @if (uploadService.hasFiles()) {
      <ul class="flex flex-col gap-1 mb-2">
        @for (f of uploadService.files(); track f.id) {
          <li
            class="flex flex-col gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm"
          >
            <div class="flex items-center justify-between gap-2">
              <span
                class="truncate font-medium text-gray-800 dark:text-gray-100 max-w-50"
              >
                {{ f.originalName ?? f.file.name }}
              </span>
              <span class="text-xs text-gray-400 shrink-0">
                {{ (f.file.size / 1024 / 1024).toFixed(1) }} MB
              </span>

              <!-- Status badge -->
              <span
                class="text-xs px-2 py-0.5 rounded-full shrink-0 font-medium"
                [class]="badgeClass(f.status)"
              >
                @switch (f.status) {
                  @case ('compressing') {
                    Compressing
                  }
                  @case ('uploading') {
                    {{ f.progress }}%
                  }
                  @case ('ready') {
                    ✓ Ready
                  }
                  @case ('error') {
                    ✗ {{ f.error }}
                  }
                }
              </span>

              <!-- Remove button (disabled while active) -->
              @if (f.status !== 'uploading' && f.status !== 'compressing') {
                <button
                  (click)="uploadService.remove(f.id)"
                  class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs ml-1 shrink-0"
                  aria-label="Remove file"
                >
                  ✕
                </button>
              }
            </div>

            <!-- Progress bar -->
            @if (f.status === 'uploading') {
              <div
                class="w-full h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
              >
                <div
                  class="h-full bg-blue-500 transition-all duration-150 rounded-full"
                  [style.width.%]="f.progress"
                ></div>
              </div>
            }
          </li>
        }
      </ul>
    }

    <!-- Toolbar -->
    <div class="flex items-center gap-2">
      <!-- Attach button -->
      <button
        (click)="fileInput.click()"
        [disabled]="uploadService.isBusy()"
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600
               rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800
               transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
          />
        </svg>
        Attach
      </button>

      <input
        #fileInput
        type="file"
        multiple
        hidden
        (change)="onFileSelect($event)"
      />

      <!-- Inline error -->
      @if (error()) {
        <span class="text-xs text-red-500 flex-1">{{ error() }}</span>
      }

      <!-- Send button -->
      <button
        (click)="send()"
        [disabled]="uploadService.isBusy()"
        class="ml-auto px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium
               rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {{ uploadService.isBusy() ? 'Uploading…' : 'Send' }}
      </button>
    </div>
  `,
})
export class FileUpload {
  readonly uploadService = inject(UploadService);

  // Emits confirmed files to parent (chat component) on send
  readonly uploaded =
    output<
      { key: string; url: string; originalName: string; mimeType: string }[]
    >();

  readonly error = signal<string | null>(null);

  onFileSelect(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // allow re-selecting same file
    if (!files.length) return;
    this.error.set(null);
    this.uploadService
      .startUpload(files)
      .catch((err) => this.error.set(err.message));
  }

  async send(): Promise<void> {
    this.error.set(null);
    if (!this.uploadService.hasFiles()) {
      // No files — parent handles text-only message
      this.uploaded.emit([]);
      return;
    }
    try {
      const files = await this.uploadService.confirmAndSend();
      this.uploaded.emit(files);
      this.uploadService.reset();
    } catch (err: any) {
      this.error.set(err.message);
    }
  }

  badgeClass(status: string): string {
    return (
      {
        compressing:
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        uploading:
          'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        ready:
          'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      }[status] ?? ''
    );
  }
}
