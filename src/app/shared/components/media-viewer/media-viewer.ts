import {
  Component,
  inject,
  HostListener,
  OnInit,
  signal,
  ChangeDetectionStrategy,
  DestroyRef,
  viewChild,
} from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { environment } from '../../../../environments/environment';
import {
  MediaItem,
  MediaViewerConfig,
} from '../../services/media-viewer.service';
import { VideoPlayer } from '../video-player/video-player';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { ModalStatesT } from '../../interfaces/modal-states.type';
import { takeUntil, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface MediaViewerData {
  mediaMessages: MediaItem[];
  currentIndex: number;
  config: MediaViewerConfig;
}

@Component({
  selector: 'app-media-viewer',
  standalone: true,
  imports: [VideoPlayer, HlmSpinner],
  templateUrl: './media-viewer.html',
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaViewer implements OnInit {
  private dialogRef = inject(DialogRef<MediaViewer>);
  private data: MediaViewerData = inject(DIALOG_DATA);

  state = signal<ModalStatesT>('open');

  apiUrl = environment.apiUrl;

  mediaMessages = this.data.mediaMessages;
  currentIndex = this.data.currentIndex;
  config = this.data.config;

  isLoading = signal<boolean>(true);
  hasError = signal<boolean>(false);

  private thumbnailStates = signal<
    Record<number, { loading: boolean; error: boolean }>
  >({});

  isZoomed = signal<boolean>(false);
  zoomLevel = 1;
  panX = 0;
  panY = 0;

  get currentMedia(): MediaItem {
    return this.mediaMessages[this.currentIndex];
  }

  ngOnInit() {
    if (this.config.enableGallery) {
      this.preloadAdjacentMedia();
    }
  }

  getThumbnailState(id: number) {
    return this.thumbnailStates()[id] ?? { loading: false, error: false };
  }

  setThumbnailLoading(id: number, loading: boolean) {
    this.thumbnailStates.update((states) => ({
      ...states,
      [id]: { ...this.getThumbnailState(id), loading },
    }));
  }

  setThumbnailError(id: number, error: boolean) {
    this.thumbnailStates.update((states) => ({
      ...states,
      [id]: { ...this.getThumbnailState(id), error },
    }));
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

  navigateToMedia(index: number) {
    if (index >= 0 && index < this.mediaMessages.length) {
      this.currentIndex = index;
      this.resetZoom();
      this.isLoading.set(true);
      this.hasError.set(false);

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
      this.isZoomed.update((val) => !val);
      this.zoomLevel = this.isZoomed() ? 2 : 1;

      if (!this.isZoomed()) {
        this.panX = 0;
        this.panY = 0;
      }
    }
  }

  resetZoom() {
    this.isZoomed.set(false);
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
  }

  getImageTransform(): string {
    if (this.isZoomed()) {
      return `scale(${this.zoomLevel}) translate(${this.panX}px, ${this.panY}px)`;
    }
    return 'scale(1) translate(0, 0)';
  }

  onMediaLoad() {
    this.isLoading.set(false);
    this.hasError.set(false);
  }

  onMediaError() {
    this.isLoading.set(false);
    this.hasError.set(true);
  }

  async downloadMedia() {
    try {
      // Show loading state if needed
      const response = await fetch(this.apiUrl + this.currentMedia.url);

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download =
        this.currentMedia.name || `media-${this.currentMedia._id}`;
      document.body.appendChild(link);
      link.click();

      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      // Show error message to user
    }
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
    this.state.set('closed');
    setTimeout(() => this.dialogRef.close(), 100); // delay to allow animations
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.closeViewer();
    }
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
