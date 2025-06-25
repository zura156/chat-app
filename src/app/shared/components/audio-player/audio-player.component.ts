import { Component, input, linkedSignal, signal } from '@angular/core';
import {
  BrnProgressComponent,
  BrnProgressIndicatorComponent,
} from '@spartan-ng/brain/progress';
import { HlmProgressIndicatorDirective } from '@spartan-ng/ui-progress-helm';
import { FormatTimePipe } from '../../pipes/format-time.pipe';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { MediaPlayerSizesT } from '../../types/media-player-sizes.type';
import { FileI } from '../../../features/messages/interfaces/message.interface';
import { environment } from '../../../../environments/environment';
import { NgIcon } from '@ng-icons/core';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';

@Component({
  selector: 'app-audio-player',
  templateUrl: './audio-player.component.html',
  imports: [
    NgIcon,
    HlmIconDirective,
    FormatTimePipe,
    BrnProgressComponent,
    BrnProgressIndicatorComponent,
    HlmProgressIndicatorDirective,
    HlmButtonDirective,
  ],
})
export class AudioPlayerComponent {
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
