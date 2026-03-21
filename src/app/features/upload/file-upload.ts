import {
  Component,
  inject,
  signal,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgFor, NgIf, NgClass, DecimalPipe } from '@angular/common';
import { UploadService, UploadFile } from './upload.service';

@Component({
  selector: 'app-file-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgFor, NgIf, NgClass, DecimalPipe],
  template: `
    <div class="upload-container">
      <!-- Drop zone -->
      <div
        class="drop-zone"
        [ngClass]="{ 'drag-over': isDragging() }"
        (click)="fileInput.click()"
        (dragover)="onDragOver($event)"
        (dragleave)="isDragging.set(false)"
        (drop)="onDrop($event)"
      >
        <span>Click or drag files here</span>
        <small>Images ≤10MB · Videos ≤50MB · Docs ≤25MB · Max 5 files</small>
      </div>

      <input
        #fileInput
        type="file"
        multiple
        hidden
        (change)="onFileSelect($event)"
      />

      <!-- Error -->
      <p *ngIf="error()" class="error">{{ error() }}</p>

      <!-- File list with progress -->
      <ul *ngIf="uploadService.files().length" class="file-list">
        <li *ngFor="let f of uploadService.files()" class="file-item">
          <span class="file-name">{{ f.file.name }}</span>
          <span class="file-size"
            >{{ f.file.size / 1024 / 1024 | number: '1.1-1' }} MB</span
          >

          <div
            class="progress-bar"
            *ngIf="f.status === 'uploading' || f.status === 'done'"
          >
            <div class="progress-fill" [style.width.%]="f.progress"></div>
          </div>

          <span class="status" [ngClass]="f.status">
            @switch (f.status) {
              @case ('pending') {
                Waiting
              }
              @case ('uploading') {
                {{ f.progress }}%
              }
              @case ('done') {
                ✓
              }
              @case ('error') {
                ✗ {{ f.error }}
              }
            }
          </span>
        </li>
      </ul>

      <!-- Send button -->
      <button
        *ngIf="uploadService.files().length && !uploadService.isUploading()"
        (click)="send()"
        [disabled]="uploadService.isUploading()"
        class="send-btn"
      >
        Send
      </button>
    </div>
  `,
  styles: [
    `
      .upload-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .drop-zone {
        border: 2px dashed #ccc;
        border-radius: 8px;
        padding: 16px;
        text-align: center;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 4px;
        transition: border-color 0.2s;
      }
      .drop-zone.drag-over {
        border-color: #4a90e2;
        background: #f0f6ff;
      }
      .drop-zone small {
        color: #888;
        font-size: 12px;
      }

      .error {
        color: red;
        font-size: 13px;
        margin: 0;
      }

      .file-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .file-item {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }
      .file-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .file-size {
        color: #888;
        white-space: nowrap;
      }

      .progress-bar {
        grid-column: 1 / -1;
        height: 3px;
        background: #eee;
        border-radius: 2px;
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        background: #4a90e2;
        transition: width 0.2s;
      }

      .status {
        font-size: 12px;
        white-space: nowrap;
      }
      .status.done {
        color: green;
      }
      .status.error {
        color: red;
      }
      .status.uploading {
        color: #4a90e2;
      }

      .send-btn {
        align-self: flex-end;
        padding: 6px 16px;
        background: #4a90e2;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
      }
      .send-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class FileUploadComponent {
  readonly uploadService = inject(UploadService);

  // Emits confirmed file URLs back to parent (chat component)
  readonly uploaded =
    output<
      { key: string; url: string; originalName: string; mimeType: string }[]
    >();

  readonly isDragging = signal(false);
  readonly error = signal<string | null>(null);

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.isDragging.set(true);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragging.set(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    this.startUpload(files);
  }

  onFileSelect(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.startUpload(files);
    input.value = ''; // reset so same file can be re-selected
  }

  private startUpload(files: File[]): void {
    this.error.set(null);
    const validationError = this.uploadService.validate(files);
    if (validationError) {
      this.error.set(validationError);
      return;
    }
    // Fire and forget — signals handle progress state
    this.uploadService
      .upload(files)
      .catch((err) => this.error.set(err.message));
  }

  send(): void {
    const done = this.uploadService.files().filter((f) => f.status === 'done');
    if (!done.length) return;
    // Emit to parent — parent attaches these to the message
    // (you'd combine file URLs from confirmRes in a real app)
    this.uploaded.emit(
      done.map((f) => ({
        key: f.key!,
        url: '', // populated from confirmRes in real app
        originalName: f.file.name,
        mimeType: f.file.type,
      })),
    );
    this.uploadService.reset();
  }
}
