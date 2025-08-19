import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { MessageService } from '../../features/messages/services/message.service';
import { MediaViewerComponent } from '../components/media-viewer/media-viewer.component';

export interface MediaItem {
  _id: string;
  url: string;
  type: 'image' | 'video';
  name?: string;
  size?: number;
  timestamp?: Date;
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
  openMedia(media: MediaItem, config: MediaViewerConfig = {}) {
    // Get all media messages if gallery is enabled
    const mediaMessages = config.enableGallery
      ? this.messageService
          .activeMediaMessages()
          .map(
            (el): MediaItem => ({
              _id: String(el._id),
              type: el.type as 'image' | 'video',
              url: String(el.file?.url),
              size: el.file?.size_in_bytes,
            })
          )
      : [media];

    // Find current media index
    const currentIndex = mediaMessages.findIndex(
      (item) => item._id === media._id
    );

    return this.dialog.open(MediaViewerComponent, {
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
  openSingleMedia(media: MediaItem, allowDownload = true) {
    return this.openMedia(media, {
      enableGallery: false,
      allowDownload,
    });
  }

  /**
   * Open media with full gallery functionality
   */
  openMediaGallery(media: MediaItem, showThumbnails = true) {
    return this.openMedia(media, {
      enableGallery: true,
      showThumbnails,
      allowDownload: true,
    });
  }
}
