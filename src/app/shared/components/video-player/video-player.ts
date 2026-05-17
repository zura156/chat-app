import {
  AfterViewInit,
  Component,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  HostListener,
  inject,
  Inject,
  input,
  linkedSignal,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideFastForward,
  lucideMaximize,
  lucideMinimize,
  lucidePause,
  lucidePlay,
  lucideRewind,
  lucideRotateCcw,
  lucideVolume,
  lucideVolume1,
  lucideVolume2,
  lucideVolumeX,
} from '@ng-icons/lucide';

import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmButton } from '@spartan-ng/helm/button';
import { MediaPlayerSizesT } from '../../types/media-player-sizes.type';
import { NgTemplateOutlet } from '@angular/common';
import { environment } from '../../../../environments/environment';
import { FormatTimePipe } from '../../pipes/format-time.pipe';
import { VideoActionsT } from '../../interfaces/video-actions.interface';
import { AttachmentI } from '../../../features/messages/interfaces/message.interface';

@Component({
  selector: 'app-video-player',
  imports: [NgIcon, HlmButton, HlmIcon, FormatTimePipe, NgTemplateOutlet],
  providers: [
    provideIcons({
      lucidePlay,
      lucidePause,
      lucideRotateCcw,
      lucideRewind,
      lucideFastForward,
      lucideVolume,
      lucideVolume1,
      lucideVolume2,
      lucideVolumeX,
      lucideMinimize,
      lucideMaximize,
    }),
  ],
  templateUrl: './video-player.html',
})
export class VideoPlayer implements AfterViewInit, OnDestroy {
  video = input.required<Partial<AttachmentI>>();
  size = input<MediaPlayerSizesT>('sm');
  disableContainerClickToggle = input<boolean>(false);
  loaded = output<void>();

  videoPlayer = viewChild<ElementRef<HTMLMediaElement>>('videoPlayer');
  playerContainer = viewChild<ElementRef<HTMLDivElement>>('playerContainer');
  timeline = viewChild<ElementRef<HTMLDivElement>>('timeline');

  destroyRef = inject(DestroyRef);

  private hideOverlayTimeout?: any;
  private hideIndicator?: any;
  private readonly OVERLAY_INACTIVITY_TIME = 3000; // 3 seconds
  private readonly INDICATOR_INACTIVITY_TIME = 500; // 3 seconds

  apiUrl = environment.apiUrl;

  styleSize = linkedSignal<MediaPlayerSizesT>(() => {
    if (this.isFullscreen()) {
      return 'lg';
    } else {
      return this.size();
    }
  });
  duration = linkedSignal<number>(() => {
    return this.videoPlayer()?.nativeElement.duration || 0;
  });
  volume = linkedSignal<number>(
    () => Number(this.videoPlayer()?.nativeElement.getAttribute('volume')) || 1,
  );
  lastVolumeBeforeMute: number = this.volume();

  currentTime = signal<number>(0);
  progressPercentage = linkedSignal<number>(() => {
    const duration = this.duration();
    const currentTime = this.currentTime();

    return duration > 0 ? Math.floor((currentTime / duration) * 100) : 0;
  });

  isFocused = signal<boolean>(false);
  isFullscreen = signal<boolean>(false);
  isDragging = signal<boolean>(false);
  isOverlayVisible = signal<boolean>(false);

  showIndicator = signal<boolean>(false);
  indicatorType = signal<VideoActionsT>(null);

  constructor(@Inject(DOCUMENT) private document: Document) {
    this.isFullscreen.set(
      !!(
        this.document.fullscreenElement ||
        (this.document as any).webkitFullscreenElement ||
        (this.document as any).mozFullScreenElement ||
        (this.document as any).msFullscreenElement
      ),
    );
  }

  ngAfterViewInit() {
    const videoElement = this.videoPlayer()?.nativeElement;

    const onPlay = () => {
      this.indicatorType.set('play');
      this.showIndicator.set(true);
      this.resetIndicatorTime();
    };

    const onPause = () => {
      this.indicatorType.set('pause');
      this.showIndicator.set(true);
      this.resetIndicatorTime();
    };

    videoElement?.addEventListener('play', onPlay);
    videoElement?.addEventListener('pause', onPause);

    this.destroyRef.onDestroy(() => {
      videoElement?.removeEventListener('play', onPlay);
      videoElement?.removeEventListener('pause', onPause);
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.hideOverlayTimeout);
    clearInterval(this.hideIndicator);
  }

  onMouseEnter() {
    this.showOverlay();
  }

  onMouseLeave() {
    this.hideOverlay();
  }

  onMouseMove() {
    this.showOverlay();
    this.resetHideTimer();
  }

  private showOverlay() {
    this.isOverlayVisible.set(true);
    this.resetHideTimer();
  }

  private hideOverlay() {
    this.isOverlayVisible.set(false);
    clearTimeout(this.hideOverlayTimeout);
  }

  private resetHideTimer() {
    clearTimeout(this.hideOverlayTimeout);
    this.hideOverlayTimeout = setTimeout(() => {
      this.isOverlayVisible.set(false);
    }, this.OVERLAY_INACTIVITY_TIME);
  }

  @HostListener('document:fullscreenchange')
  @HostListener('document:webkitfullscreenchange')
  @HostListener('document:mozfullscreenchange')
  @HostListener('document:msfullscreenchange')
  onFullscreenChange() {
    if (this.disableContainerClickToggle()) return;
    this.isFullscreen.set(!!this.getFullscreenElement());
  }

  private getFullscreenElement(): Element | null {
    return (
      this.document.fullscreenElement ||
      (this.document as any).webkitFullscreenElement ||
      (this.document as any).mozFullScreenElement ||
      (this.document as any).msFullscreenElement
    );
  }

  onTimeUpdate(videoElement: HTMLVideoElement): void {
    videoElement.currentTime;
    this.currentTime.set(videoElement.currentTime);
  }

  setVolume(event: Event): void {
    event.preventDefault();

    const input = event.target as HTMLInputElement;

    this.videoPlayer()?.nativeElement.setAttribute('volume', input.value);
    this.volume.set(Number(input.value));
  }

  onVolumeScroll(event: WheelEvent | KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();

    let delta;
    let newVolume;

    if (event instanceof WheelEvent) {
      delta = Math.sign(event.deltaY);
      newVolume = Math.max(0, Math.min(1, this.volume() - delta * 0.05));
    } else if (event instanceof KeyboardEvent) {
      if (event.key === 'ArrowUp') {
        newVolume = Math.min(1, this.volume() + 0.05);
      } else if (event.key === 'ArrowDown') {
        newVolume = Math.max(0, this.volume() - 0.05);
      } else {
        return;
      }
    }

    this.videoPlayer()?.nativeElement.setAttribute('volume', String(newVolume));
    this.volume.set(Number(newVolume));
  }

  toggleFullscreen(): void {
    const element = this.playerContainer()?.nativeElement;
    if (!element) return;

    if (this.isFullscreen()) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen(element);
    }
  }

  private enterFullscreen(element: HTMLElement): void {
    try {
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if ((element as any).webkitRequestFullscreen) {
        // Safari
        (element as any).webkitRequestFullscreen();
      } else if ((element as any).mozRequestFullScreen) {
        // Firefox
        (element as any).mozRequestFullScreen();
      } else if ((element as any).msRequestFullscreen) {
        // IE/Edge
        (element as any).msRequestFullscreen();
      }
    } catch (error) {
      console.warn('Fullscreen not supported or failed:', error);
    }
  }

  private exitFullscreen(): void {
    try {
      if (this.document.exitFullscreen) {
        this.document.exitFullscreen();
      } else if ((this.document as any).webkitExitFullscreen) {
        (this.document as any).webkitExitFullscreen();
      } else if ((this.document as any).webkitCancelFullScreen) {
        (this.document as any).webkitCancelFullScreen();
      } else if ((this.document as any).mozCancelFullScreen) {
        (this.document as any).mozCancelFullScreen();
      } else if ((this.document as any).msExitFullscreen) {
        (this.document as any).msExitFullscreen();
      }
    } catch (error) {
      console.warn('Exit fullscreen failed:', error);
    }
  }

  setCurrentTime(event: MouseEvent) {
    const timelineElement = this.timeline();
    if (!timelineElement) return;

    const rect = timelineElement.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left; // x position within the element.
    const width = rect.width;
    const percentage = Math.max(0, Math.min(1, x / width)); // Ensure value is between 0 and 1
    const newTime = percentage * this.duration();

    this.currentTime.set(newTime);
    const videoPlayerEl = this.videoPlayer()?.nativeElement;

    if (videoPlayerEl) {
      videoPlayerEl.currentTime = newTime;
    }
  }

  onTimelineMousedown(event: MouseEvent): void {
    this.isDragging.set(true);
    this.setCurrentTime(event);
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMousemove(event: MouseEvent): void {
    const timelineElement = this.timeline();
    if (this.isDragging() && timelineElement) {
      this.setCurrentTime(event);
    }
  }

  @HostListener('window:mouseup', ['$event'])
  onWindowMouseup(event: MouseEvent): void {
    this.isDragging.set(false);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (this.disableContainerClickToggle()) return;
    if (!this.isFocused()) return;

    event.preventDefault();
    switch (event.key) {
      case 'ArrowUp':
        this.volumeUp();
        break;

      case 'ArrowDown':
        this.volumeDown();
        break;

      case 'm':
        this.volumeMute();
        break;
      case ' ':
      case 'Space':
        event.stopPropagation();
        this.togglePlayback();
        break;
      case 'f':
        this.toggleFullscreen();
        break;
      case 'ArrowLeft':
        this.seekBackward();
        break;
      case 'ArrowRight':
        this.seekForward();
        break;
    }
  }

  togglePlayback(): void {
    const videoElement = this.videoPlayer()?.nativeElement;
    if (!videoElement) {
      return;
    }
    if (videoElement.paused) {
      videoElement.play();
    } else {
      videoElement.pause();
    }
  }

  public pauseVideo(): void {
    if (
      !this.videoPlayer()?.nativeElement ||
      this.videoPlayer()?.nativeElement.paused
    )
      return;
    this.videoPlayer()?.nativeElement.pause();
    this.indicatorType.set('pause');

    this.showIndicator.set(true);
    this.resetIndicatorTime();
  }

  private volumeMute(): void {
    if (this.volume()) this.lastVolumeBeforeMute = this.volume();

    this.volume.update((prev) => (prev > 0 ? 0 : this.lastVolumeBeforeMute));

    this.indicatorType.set('volume-change');
    this.showIndicator.set(true);
    this.resetIndicatorTime();
  }

  private volumeUp(): void {
    const videoPlayer = this.videoPlayer()?.nativeElement;

    if (!videoPlayer) return;

    this.volume.update((prev) => Math.min(1, prev + 0.05));
    this.indicatorType.set('volume-change');
    this.showIndicator.set(true);
    this.resetIndicatorTime();
  }

  private volumeDown(): void {
    const videoPlayer = this.videoPlayer()?.nativeElement;

    if (!videoPlayer) return;

    this.volume.update((prev) => Math.max(0, prev - 0.05));
    this.indicatorType.set('volume-change');
    this.showIndicator.set(true);
    this.resetIndicatorTime();
  }

  private seekForward(): void {
    const videoElement = this.videoPlayer()?.nativeElement;

    if (videoElement) {
      if (videoElement.currentTime === videoElement.duration) {
        return;
      }

      videoElement.currentTime = Math.min(
        videoElement.duration,
        videoElement.currentTime + 5,
      );
      this.currentTime.set(videoElement.currentTime);
      this.indicatorType.set('forward');
      this.showIndicator.set(true);
      this.resetIndicatorTime();
    }
  }

  private seekBackward(): void {
    const videoElement = this.videoPlayer()?.nativeElement;
    if (videoElement) {
      videoElement.currentTime = Math.max(0, videoElement.currentTime - 5);
      this.currentTime.set(videoElement.currentTime);
      this.indicatorType.set('backward');
      this.showIndicator.set(true);
      this.resetIndicatorTime();
    }
  }

  private resetIndicatorTime(): void {
    clearTimeout(this.hideIndicator);
    this.hideIndicator = setTimeout(() => {
      this.showIndicator.set(false);
    }, this.INDICATOR_INACTIVITY_TIME);
  }
}
