import { Component, input, linkedSignal, signal } from '@angular/core';
import { FormatTimePipe } from '../../pipes/format-time.pipe';
import { HlmButton } from '@spartan-ng/helm/button';
import { MediaPlayerSizesT } from '../../types/media-player-sizes.type';
import { FileI } from '../../../features/messages/interfaces/message.interface';
import { environment } from '../../../../environments/environment';
import { NgIcon } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmProgressImports } from '@spartan-ng/helm/progress';

@Component({
  selector: 'app-audio-player',
  templateUrl: './audio-player.html',
  imports: [
    NgIcon,
    HlmIcon,
    FormatTimePipe,
    HlmProgressImports,
    HlmButton,
  ],
})
export class AudioPlayer {
  audio = input.required<FileI>();
  size = input<MediaPlayerSizesT>('sm'); // (no support yet)
  readonly apiUrl = environment.apiUrl;

  currentTime = signal<number>(0);
  duration = linkedSignal<number>(() => this.audio()?.duration || 0);
  progressPercentage = linkedSignal<number>(() => {
    const duration = this.duration();

    return duration > 0
      ? Math.floor((this.currentTime() / this.duration()) * 100)
      : 0;
  });

  onTimeUpdate(audio: HTMLAudioElement): void {
    this.currentTime.set(audio.currentTime);

    if (audio.paused || audio.ended) {
      this.progressPercentage.set(100);
    }
  }
}
