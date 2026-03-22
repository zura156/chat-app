import { Component, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrash2, lucideDownload } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmProgressImports } from '@spartan-ng/helm/progress';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';

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
export class DataStorageSettings {
  storageItems = signal([
    { label: 'Images', size: '128 MB', percent: 42 },
    { label: 'Videos', size: '256 MB', percent: 68 },
    { label: 'Audio', size: '48 MB', percent: 16 },
    { label: 'Documents', size: '12 MB', percent: 4 },
    { label: 'Cache', size: '32 MB', percent: 10 },
  ]);

  autoDownloadItems = signal([
    { key: 'images', label: 'Images', enabled: signal(true) },
    { key: 'videos', label: 'Videos', enabled: signal(false) },
    { key: 'audio', label: 'Audio messages', enabled: signal(true) },
    { key: 'documents', label: 'Documents', enabled: signal(false) },
  ]);

  clearCache() {
    this.storageItems.update((items) =>
      items.map((item) =>
        item.label === 'Cache' ? { ...item, size: '0 MB', percent: 0 } : item,
      ),
    );
    // wire up actual cache clearing
  }

  requestExport() {
    // wire up API call
  }
}
