import {
  Component,
  DOCUMENT,
  ElementRef,
  HostListener,
  Inject,
  input,
  linkedSignal,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleArrowLeft,
  lucideCircleArrowRight,
  lucideCirclePause,
  lucideCirclePlay,
  lucideCircleStop,
  lucideFastForward,
  lucideFullscreen,
  lucideMinimize,
  lucideRotateCcw,
  lucideVolume,
  lucideVolume1,
  lucideVolume2,
  lucideVolumeX,
} from '@ng-icons/lucide';
import { FileI } from '../../../features/messages/interfaces/message.interface';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { MediaPlayerSizesT } from '../../types/media-player-sizes.type';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { environment } from '../../../../environments/environment';
import { FormatTimePipe } from '../../pipes/format-time.pipe';
import { VideoActionsT } from '../../interfaces/video-actions.interface';

@Component({
  selector: 'app-video-player',
  imports: [
    NgIcon,
    NgClass,
    HlmButtonDirective,
    HlmIconDirective,
    FormatTimePipe,
    NgTemplateOutlet,
  ],
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
      lucideCircleStop,
      lucideRotateCcw,
      lucideVolume,
      lucideVolume1,
      lucideVolume2,
      lucideVolumeX,
      lucideMinimize,
      lucideFullscreen,
      lucideCircleArrowLeft,
      lucideCircleArrowRight,
      lucideFastForward,
    }),
  ],
  templateUrl: './video-player.component.html',
})
export class VideoPlayerComponent implements OnDestroy {
  video = input.required<FileI>();
  size = input<MediaPlayerSizesT>('sm');

  videoPlayer = viewChild<ElementRef<HTMLMediaElement>>('videoPlayer');
  playerContainer = viewChild<ElementRef<HTMLDivElement>>('playerContainer');
  timeline = viewChild<ElementRef<HTMLDivElement>>('timeline');

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
    () => Number(this.videoPlayer()?.nativeElement.getAttribute('volume')) || 1
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

  constructor(@Inject(DOCUMENT) private document: Document) {}

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
    const fullScreenElement = this.document.fullscreenElement;

    if (fullScreenElement) {
      this.document.exitFullscreen();
    } else {
      this.playerContainer()?.nativeElement.requestFullscreen();
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
    if (!this.isFocused()) {
      return;
    }

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

  private togglePlayback(): void {
    const videoElement = this.videoPlayer()?.nativeElement;
    if (!videoElement) {
      return;
    }
    if (videoElement.paused) {
      videoElement.play();
      this.indicatorType.set('play');
    } else {
      videoElement.pause();
      this.indicatorType.set('pause');
    }
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
        videoElement.currentTime + 5
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
