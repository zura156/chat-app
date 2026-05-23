import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { MessageService } from '../../features/messages/services/message.service';
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
  private messageService = inject(MessageService);

  /**
   * Opens media viewer with optional gallery functionality
   * @param media - The media item to display
   * @param config - Configuration options for the viewer
   */
  openMedia(media: MediaItem, index: number, config: MediaViewerConfig = {}) {
    let mediaItems: MediaItem[];
    let currentIndex: number;

    if (config.enableGallery) {
      // Flatten every ready attachment across all media messages
      mediaItems = this.messageService.activeMediaMessages().flatMap((el) =>
        (el.attachments ?? [])
          .filter((a) => a.status === 'ready' && a.variants)
          .map(
            (a): MediaItem => ({
              _id: String(el._id),
              uploadId: a.uploadId,
              type: el.type as 'image' | 'video',
              url: a.variants?.large || a.variants?.medium || '',
              thumbnail: a.variants?.thumbnail || a.variants?.thumb, // video poster or fallback
              thumb: a.variants?.thumb,
              name: a.originalName,
              size: a.fileSize,
            }),
          ),
      );

      // Find clicked item by uploadId — index within message is meaningless globally
      currentIndex = media.uploadId
        ? mediaItems.findIndex((m) => m.uploadId === media.uploadId)
        : 0;
      if (currentIndex < 0) currentIndex = 0;
    } else {
      mediaItems = [media];
      currentIndex = 0;
    }

    return this.dialog.open(MediaViewer, {
      data: {
        mediaMessages: mediaItems,
        currentIndex,
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

  hasEnoughForGallery(): boolean {
    return (
      this.messageService
        .activeMediaMessages()
        .reduce(
          (count, msg) =>
            count +
            (msg.attachments?.filter((a) => a.status === 'ready' && a.variants)
              .length ?? 0),
          0,
        ) > 1
    );
  }
}
