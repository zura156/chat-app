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
  lucideCirclePause,
  lucideCirclePlay,
  lucideCircleStop,
  lucideFullscreen,
  lucideMinimize,
  lucideVolume,
  lucideVolume1,
  lucideVolume2,
  lucideVolumeX,
} from '@ng-icons/lucide';
import { FileI } from '../../../features/messages/interfaces/message.interface';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { MediaPlayerSizesT } from '../../types/media-player-sizes.type';
import { NgClass } from '@angular/common';
import { environment } from '../../../../environments/environment';
import { FormatTimePipe } from '../../pipes/format-time.pipe';

@Component({
  selector: 'app-video-player',
  imports: [
    NgIcon,
    NgClass,
    HlmButtonDirective,
    HlmIconDirective,
    FormatTimePipe,
  ],
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
      lucideCircleStop,
      lucideVolume,
      lucideVolume1,
      lucideVolume2,
      lucideVolumeX,
      lucideMinimize,
      lucideFullscreen,
    }),
  ],
  templateUrl: './video-player.component.html',
})
export class VideoPlayerComponent {
  video = input.required<FileI>();
  size = input<MediaPlayerSizesT>('sm');
  videoPlayer = viewChild<ElementRef<HTMLMediaElement>>('videoPlayer');
  playerContainer = viewChild<ElementRef<HTMLDivElement>>('playerContainer');
  timeline = viewChild<ElementRef<HTMLDivElement>>('timeline');

  apiUrl = environment.apiUrl;

  duration = linkedSignal<number>(() => {
    return this.videoPlayer()?.nativeElement.duration || 0;
  });
  volume = linkedSignal<number>(
    () => Number(this.videoPlayer()?.nativeElement.getAttribute('volume')) || 1
  );

  currentTime = signal<number>(0);
  progressPercentage = linkedSignal<number>(() => {
    const duration = this.duration();
    const currentTime = this.currentTime();

    return duration > 0 ? Math.floor((currentTime / duration) * 100) : 0;
  });

  isFocused = signal<boolean>(false);
  isFullscreen = signal<boolean>(false);
  isDragging = signal<boolean>(false);

  constructor(@Inject(DOCUMENT) private document: Document) {}

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

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault(); // Prevents the page from scrolling
        this.volume.update((prev) => Math.min(1, prev + 0.05));
        break;

      case 'ArrowDown':
        event.preventDefault(); // Prevents the page from scrolling
        this.volume.update((prev) => Math.max(0, prev - 0.05));
        break;

      case 'm':
        event.preventDefault();
        this.volume.update((prev) => (prev > 0 ? 0 : 1));
        break;
      case ' ':
        event.preventDefault();
        const videoElement = this.videoPlayer()?.nativeElement;
        if (!videoElement) {
          return;
        }
        if (videoElement.paused) {
          videoElement.play();
        } else {
          videoElement.pause();
        }
        break;
      case 'f':
        event.preventDefault();
        this.toggleFullscreen();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        const videoElementLeft = this.videoPlayer()?.nativeElement;
        if (videoElementLeft) {
          videoElementLeft.currentTime = Math.max(
            0,
            videoElementLeft.currentTime - 5
          );
          this.currentTime.set(videoElementLeft.currentTime);
        }
        break;
      case 'ArrowRight':
        event.preventDefault();
        const videoElementRight = this.videoPlayer()?.nativeElement;
        if (videoElementRight) {
          videoElementRight.currentTime = Math.min(
            videoElementRight.duration,
            videoElementRight.currentTime + 5
          );
          this.currentTime.set(videoElementRight.currentTime);
        }
        break;
    }
  }
}
