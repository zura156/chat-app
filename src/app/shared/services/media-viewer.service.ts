import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { MessageService } from '../../features/messages/services/message.service';
import { MediaViewer } from '../components/media-viewer/media-viewer';

export interface MediaItem {
  _id: string;
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
  private messageService = inject(MessageService);

  /**
   * Opens media viewer with optional gallery functionality
   * @param media - The media item to display
   * @param config - Configuration options for the viewer
   */
  openMedia(media: MediaItem, index: number, config: MediaViewerConfig = {}) {
    // Get all media messages if gallery is enabled
    const mediaMessages = config.enableGallery
      ? this.messageService.activeMediaMessages().map(
          (el): MediaItem => ({
            _id: String(el._id),
            type: el.type as 'image' | 'video',
            url:
              el.attachments?.[0]?.variants?.medium ||
              el.attachments?.[0]?.variants?.original ||
              '',
            thumbnail: el.attachments?.[0]?.variants?.thumbnail,
            thumb: el.attachments?.[0]?.variants?.thumb,
            name: el.attachments?.[0]?.originalName,
            size: el.attachments?.[0]?.fileSize,
          }),
        )
      : [media];

    // Find current media index
    const currentIndex = index;

    return this.dialog.open(MediaViewer, {
      data: {
        mediaMessages,
        currentIndex: currentIndex >= 0 ? currentIndex : 0,
        config: {
          enableGallery: false,
          showThumbnails: false,
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

  /**
   * Quick method to open single media without gallery
   */
  openSingleMedia(media: MediaItem, index: number, allowDownload = true) {
    return this.openMedia(media, index, {
      enableGallery: false,
      allowDownload,
    });
  }

  /**
   * Open media with full gallery functionality
   */
  openMediaGallery(media: MediaItem, index: number, showThumbnails = true) {
    return this.openMedia(media, index, {
      enableGallery: true,
      showThumbnails,
      allowDownload: true,
    });
  }
}
