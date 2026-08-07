import { Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrash2, lucideDownload } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmProgressImports } from '@spartan-ng/helm/progress';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { toast } from '@spartan-ng/brain/sonner';
import { StorageSettingsService } from '../../../services/storage-settings.service';
import { apiErrorMessage } from '../../../../../shared/functions/api-error';

/**
 * This screen used to show invented storage figures ("Images — 128 MB, 42%"),
 * a Clear cache button that only rewrote the local array so it looked like it
 * had worked, and an empty `requestExport()`.
 *
 * The totals now come from the uploads this account actually owns, the cache
 * figure from `navigator.storage.estimate()`, and the export downloads real
 * data. The auto-download toggles are gone: nothing honoured them and there was
 * no setting behind them to honour.
 */
@Component({
  templateUrl: './data-storage-settings.html',
  imports: [
    NgIcon,
    HlmIconImports,
    HlmSeparatorImports,
    HlmButtonImports,
    HlmProgressImports,
  ],
  providers: [provideIcons({ lucideTrash2, lucideDownload })],
})
export class DataStorageSettings implements OnInit {
  private readonly storage = inject(StorageSettingsService);

  readonly usage = this.storage.usage;
  readonly loading = this.storage.loading;
  readonly cacheBytes = this.storage.cacheBytes;

  readonly clearing = signal(false);
  readonly exporting = signal(false);

  ngOnInit(): void {
    this.storage.load().subscribe();
    void this.storage.measureCache();
  }

  format(bytes: number | null | undefined): string {
    return this.storage.formatBytes(bytes);
  }

  async clearCache(): Promise<void> {
    this.clearing.set(true);
    try {
      await this.storage.clearCache();
      toast.success('Cached data cleared');
    } catch {
      toast.error('Could not clear cached data');
    } finally {
      this.clearing.set(false);
    }
  }

  requestExport(): void {
    this.exporting.set(true);
    this.storage.downloadExport().subscribe({
      next: () => {
        this.exporting.set(false);
        toast.success('Export downloaded');
      },
      error: (err) => {
        this.exporting.set(false);
        toast.error(apiErrorMessage(err, 'Could not export your data'));
      },
    });
  }
}
