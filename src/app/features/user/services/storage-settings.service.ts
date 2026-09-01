import { Service, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface StorageCategoryI {
  label: string;
  bytes: number;
  count: number;
  percent: number;
}

export interface StorageUsageI {
  total_bytes: number;
  categories: StorageCategoryI[];
}

/**
 * Backs the data & storage screen, which previously showed invented totals
 * ("Images — 128 MB, 42%") and a Clear cache button that only rewrote the local
 * array so it appeared to have worked.
 */
@Service()
export class StorageSettingsService {
  private readonly http = inject(HttpClient);
  private readonly userUrl = `${environment.apiUrl}/user`;

  private readonly _usage = signal<StorageUsageI | null>(null);
  readonly usage = this._usage.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  private readonly _cacheBytes = signal<number | null>(null);
  readonly cacheBytes = this._cacheBytes.asReadonly();

  load() {
    this._loading.set(true);
    return this.http.get<StorageUsageI>(`${this.userUrl}/storage`).pipe(
      tap({
        next: (usage) => {
          this._usage.set(usage);
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      }),
    );
  }

  /**
   * What this browser is actually holding. `navigator.storage.estimate()` is
   * the only real answer available to a web client — the previous screen
   * reported a made-up figure.
   */
  async measureCache(): Promise<void> {
    if (!('storage' in navigator) || !navigator.storage?.estimate) {
      this._cacheBytes.set(null);
      return;
    }

    const estimate = await navigator.storage.estimate();
    this._cacheBytes.set(estimate.usage ?? null);
  }

  /** Clears the caches this origin controls, then re-measures. */
  async clearCache(): Promise<void> {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    // Session storage is this tab's scratch space; localStorage is left alone
    // because the auth flag lives there and clearing it signs the user out.
    sessionStorage.clear();

    await this.measureCache();
  }

  /** Streams the export to a file without leaving the page. */
  downloadExport() {
    return this.http
      .get(`${this.userUrl}/export`, { responseType: 'blob' })
      .pipe(
        tap((blob) => {
          /*
           * The anchor is put in the document and the URL is revoked on a later
           * task. Firefox ignores a synthetic click on a detached anchor, and
           * revoking synchronously can cancel the transfer before it starts —
           * so the toast said "Export downloaded" and nothing was saved. This
           * is what `MediaViewer.downloadMedia` already does.
           */
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `chat-app-export-${Date.now()}.json`;
          anchor.style.display = 'none';
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }),
      );
  }

  formatBytes(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined) return 'Unknown';
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
    const value = bytes / 1024 ** exponent;

    return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
  }
}
