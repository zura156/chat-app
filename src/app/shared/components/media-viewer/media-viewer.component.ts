import {
  Component,
  inject,
  HostListener,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { environment } from '../../../../environments/environment';
import {
  MediaItem,
  MediaViewerConfig,
} from '../../services/media-viewer.service';
import { VideoPlayerComponent } from '../video-player/video-player.component';

interface MediaViewerData {
  mediaMessages: MediaItem[];
  currentIndex: number;
  config: MediaViewerConfig;
}

@Component({
  selector: 'app-media-viewer',
  standalone: true,
  imports: [VideoPlayerComponent],
  templateUrl: './media-viewer.component.html',
  styles: [
    `
      .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
      .scrollbar-hide::-webkit-scrollbar {
        display: none;
      }
    `,
  ],
})
export class MediaViewerComponent implements OnInit, OnDestroy {
  private dialogRef = inject(DialogRef<MediaViewerComponent>);
  private data: MediaViewerData = inject(DIALOG_DATA);

  apiUrl = environment.apiUrl;

  mediaMessages = this.data.mediaMessages;
  currentIndex = this.data.currentIndex;
  config = this.data.config;

  isLoading = true;
  hasError = false;
  isZoomed = false;
  zoomLevel = 1;
  panX = 0;
  panY = 0;

  get currentMedia(): MediaItem {
    return this.mediaMessages[this.currentIndex];
  }

  ngOnInit() {
    // Preload adjacent media for smoother navigation
    if (this.config.enableGallery) {
      this.preloadAdjacentMedia();
    }
  }

  ngOnDestroy() {
    // Cleanup any ongoing operations
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        this.closeViewer();
        break;
      case 'ArrowLeft':
        if (this.config.enableGallery) {
          this.navigatePrevious();
        }
        break;
      case 'ArrowRight':
        if (this.config.enableGallery) {
          this.navigateNext();
        }
        break;
      case ' ':
        event.preventDefault();
        this.togglePlayPause();
        break;
    }
  }

  @HostListener('click', ['$event'])
  handleBackdropClick(event: MouseEvent) {
    // Close on backdrop click (but not on media click)
    if (event.target === event.currentTarget) {
      this.closeViewer();
    }
  }

  navigateToMedia(index: number) {
    if (index >= 0 && index < this.mediaMessages.length) {
      this.currentIndex = index;
      this.resetZoom();
      this.isLoading = true;
      this.hasError = false;

      // Preload adjacent media
      this.preloadAdjacentMedia();
    }
  }

  navigatePrevious() {
    if (this.canNavigatePrevious()) {
      this.navigateToMedia(this.currentIndex - 1);
    }
  }

  navigateNext() {
    if (this.canNavigateNext()) {
      this.navigateToMedia(this.currentIndex + 1);
    }
  }

  canNavigatePrevious(): boolean {
    return this.currentIndex > 0;
  }

  canNavigateNext(): boolean {
    return this.currentIndex < this.mediaMessages.length - 1;
  }

  toggleZoom() {
    if (this.currentMedia.type === 'image') {
      this.isZoomed = !this.isZoomed;
      this.zoomLevel = this.isZoomed ? 2 : 1;

      if (!this.isZoomed) {
        this.panX = 0;
        this.panY = 0;
      }
    }
  }

  resetZoom() {
    this.isZoomed = false;
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
  }

  getImageTransform(): string {
    if (this.isZoomed) {
      return `scale(${this.zoomLevel}) translate(${this.panX}px, ${this.panY}px)`;
    }
    return 'scale(1) translate(0, 0)';
  }

  onMediaLoad() {
    this.isLoading = false;
    this.hasError = false;
  }

  onMediaError() {
    this.isLoading = false;
    this.hasError = true;
  }

  downloadMedia() {
    const link = document.createElement('a');
    link.href = this.apiUrl + this.currentMedia.url;
    link.download = this.currentMedia.name || `media-${this.currentMedia._id}`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  togglePlayPause() {
    const videoElement = document.querySelector('video') as HTMLVideoElement;
    if (videoElement) {
      if (videoElement.paused) {
        videoElement.play();
      } else {
        videoElement.pause();
      }
    }
  }

  closeViewer() {
    this.dialogRef.close();
  }

  private preloadAdjacentMedia() {
    // Preload previous and next media for smoother navigation
    const indicesToPreload = [
      this.currentIndex - 1,
      this.currentIndex + 1,
    ].filter((i) => i >= 0 && i < this.mediaMessages.length);

    indicesToPreload.forEach((index) => {
      const media = this.mediaMessages[index];
      if (media.type === 'image') {
        const img = new Image();
        img.src = this.apiUrl + media.url;
      }
    });
  }
}
