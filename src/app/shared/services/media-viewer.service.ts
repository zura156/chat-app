import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { MediaViewer } from '../components/media-viewer/media-viewer';

export interface MediaItem {
  _id: string;
  uploadId?: string; // needed to find correct position in flattened gallery
  type: 'image' | 'video';
  url: string; // full CDN URL — no apiUrl prefix needed
  thumbnail?: string; // video thumbnail
  thumb?: string; // small preview (was placeholder_url)
  name?: string;
  size?: number;
}

export interface MediaViewerConfig {
  enableGallery?: boolean;
  showThumbnails?: boolean;
  allowDownload?: boolean;
  autoPlay?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class MediaViewerService {
  private dialog = inject(Dialog);

  openGallery(
    items: MediaItem[],
    startIndex: number,
    config: Partial<MediaViewerConfig> = {},
  ) {
    return this.dialog.open(MediaViewer, {
      data: {
        mediaMessages: items,
        currentIndex: Math.max(0, Math.min(startIndex, items.length - 1)),
        config: {
          enableGallery: items.length > 1,
          showThumbnails: items.length > 1,
          allowDownload: true,
          autoPlay: false,
          ...config,
        },
      },
      panelClass: [
        'media-viewer-dialog',
        'fixed',
        'inset-0',
        'z-50',
        'bg-transparent',
        'overflow-hidden',
      ],
      hasBackdrop: true,
      backdropClass: 'media-viewer-backdrop',
      disableClose: false,
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
    });
  }
}
