import {
  Component,
  ElementRef,
  HostListener,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCirclePause,
  lucideCirclePlay,
  lucideCircleStop,
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

@Component({
  selector: 'app-video-player',
  imports: [NgIcon, NgClass, HlmButtonDirective, HlmIconDirective],
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
      lucideCircleStop,
      lucideVolume,
      lucideVolume1,
      lucideVolume2,
      lucideVolumeX,
    }),
  ],
  templateUrl: './video-player.component.html',
})
export class VideoPlayerComponent {
  video = input.required<FileI>();
  size = input<MediaPlayerSizesT>('sm');
  videoPlayer = viewChild<ElementRef<HTMLMediaElement>>('videoPlayer');
  playerContainer = viewChild<ElementRef<HTMLDivElement>>('playerContainer');

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

    return duration > 0
      ? Math.floor((this.currentTime() / this.duration()) * 100)
      : 0;
  });

  isFocused = signal<boolean>(false);

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
        const fullScreenElement = document.fullscreenElement;
        if (fullScreenElement) {
          document.exitFullscreen();
        } else {
          this.playerContainer()?.nativeElement.requestFullscreen();
        }
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
