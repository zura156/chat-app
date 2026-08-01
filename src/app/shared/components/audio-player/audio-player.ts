import {
  Component,
  computed,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormatTimePipe } from '../../pipes/format-time.pipe';
import { HlmButton } from '@spartan-ng/helm/button';
import { MediaPlayerSizesT } from '../../types/media-player-sizes.type';
import { AttachmentI } from '../../../features/messages/interfaces/message.interface';
import { environment } from '../../../../environments/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { lucidePause, lucidePlay } from '@ng-icons/lucide';
import { pseudoWaveform } from '../../utils/pseudo-waveform';

@Component({
  selector: 'app-audio-player',
  templateUrl: './audio-player.html',
  imports: [NgIcon, HlmIconImports, FormatTimePipe, HlmButton],
  providers: [provideIcons({ lucidePlay, lucidePause })],
})
export class AudioPlayer {
  audio = input.required<AttachmentI>();
  size = input<MediaPlayerSizesT>('sm'); // (no support yet)
  readonly apiUrl = environment.apiUrl;

  currentTime = signal<number>(0);
  duration = computed<number>(() => this.audio()?.duration || 0);
  progressPercentage = linkedSignal<number>(() => {
    const duration = this.duration();

    return duration > 0
      ? Math.floor((this.currentTime() / this.duration()) * 100)
      : 0;
  });

  // Not real audio peaks — see pseudo-waveform.ts for why.
  readonly bars = computed(() =>
    pseudoWaveform(this.audio()?.uploadId ?? '', 28),
  );
  readonly playedBars = computed(() =>
    Math.round((this.progressPercentage() / 100) * this.bars().length),
  );

  onTimeUpdate(audio: HTMLAudioElement): void {
    this.currentTime.set(audio.currentTime);

    // only a finished track is 100% — this used to fire on `paused` too, so
    // pausing halfway jumped the bar (now the waveform) straight to full
    if (audio.ended) {
      this.progressPercentage.set(100);
    }
  }

  seek(event: MouseEvent, audio: HTMLAudioElement): void {
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );

    // `duration()` comes from the attachment metadata, which is 0 for uploads
    // processed before duration extraction existed — fall back to the element.
    const total = this.duration() || (Number.isFinite(audio.duration) ? audio.duration : 0);
    if (!total) return;

    audio.currentTime = ratio * total;
    this.currentTime.set(audio.currentTime);
  }
}
