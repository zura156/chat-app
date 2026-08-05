import {
  Component,
  DestroyRef,
  computed,
  inject,
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
import { mediaIdentity } from '../../services/signed-media.service';

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

  /**
   * The URL bound to the element, held steady across re-signing.
   *
   * Same reasoning as the video player: attachment URLs are presigned against
   * an hour-rounded timestamp, so the same object produces a different URL
   * either side of an hour boundary, and rebinding `[src]` restarts playback
   * from zero. The template bound `file.variants?.original` directly.
   */
  readonly src = linkedSignal<string, string>({
    source: () => this.audio()?.variants?.original ?? '',
    computation: (incoming, previous) => {
      const held = previous?.value;
      if (!held) return incoming;
      if (!incoming) return held;
      return mediaIdentity(incoming) === mediaIdentity(held) ? held : incoming;
    },
  });

  currentTime = signal<number>(0);

  /** Duration the element reports, once metadata has loaded. */
  private readonly elementDuration = signal<number>(0);

  /**
   * Metadata duration written by the worker, with the element as a fallback.
   *
   * Uploads processed before duration extraction existed store `0`, and a zero
   * duration means the progress calculation below is permanently 0 — the
   * waveform never advances at all for those messages.
   */
  duration = computed<number>(
    () => this.audio()?.duration || this.elementDuration(),
  );

  progressPercentage = linkedSignal<number>(() => {
    const total = this.duration();
    return total > 0
      ? Math.min(100, (this.currentTime() / total) * 100)
      : 0;
  });

  // Not real audio peaks — see pseudo-waveform.ts for why.
  readonly bars = computed(() =>
    pseudoWaveform(this.audio()?.uploadId ?? '', 28),
  );
  readonly playedBars = computed(() =>
    Math.round((this.progressPercentage() / 100) * this.bars().length),
  );

  /**
   * Playback position is sampled per animation frame, not from `timeupdate`.
   *
   * `timeupdate` is specified to fire "about" every 250ms, and browsers take
   * that literally — roughly four times a second. A 5-second voice note draws
   * 28 bars, which is 5.6 bars per second, so bars lit up two at a time on
   * 250ms boundaries: visibly stepped, and worse the shorter the clip.
   *
   * The loop only runs while audio is actually playing, and it only writes the
   * signal when something the template renders has changed — the index of the
   * last lit bar, or the whole second shown on the clock. Writing every frame
   * would schedule a change-detection pass 60 times a second for the whole
   * application, which is a real cost in a long thread and buys nothing: the
   * view cannot show more resolution than it has bars.
   */
  private rafId?: number;
  private lastRenderedBar = -1;
  private lastRenderedSecond = -1;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTracking());
  }

  onPlay(audio: HTMLAudioElement): void {
    this.stopTracking();

    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      this.sample(audio);
    };
    tick();
  }

  onPause(audio: HTMLAudioElement): void {
    this.stopTracking();
    // A final exact reading, so pausing lands the waveform where the audio is
    // rather than wherever the last accepted sample left it.
    this.commit(audio.currentTime);
  }

  onEnded(): void {
    this.stopTracking();
    this.progressPercentage.set(100);
  }

  /**
   * Kept as a safety net alongside the frame loop: it is the only thing that
   * fires when the element seeks while paused, or when playback advances
   * without a `play` event (a resume after buffering, for instance).
   */
  onTimeUpdate(audio: HTMLAudioElement): void {
    if (this.rafId !== undefined) return; // the loop already has this covered
    this.commit(audio.currentTime);
  }

  private sample(audio: HTMLAudioElement): void {
    const total = this.duration();
    if (!total) return;

    const time = audio.currentTime;
    const bar = Math.round((time / total) * this.bars().length);
    const second = Math.floor(time);

    if (bar === this.lastRenderedBar && second === this.lastRenderedSecond) {
      return;
    }
    this.commit(time);
  }

  private commit(time: number): void {
    const total = this.duration();
    this.lastRenderedBar = total
      ? Math.round((time / total) * this.bars().length)
      : -1;
    this.lastRenderedSecond = Math.floor(time);
    this.currentTime.set(time);
  }

  private stopTracking(): void {
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
  }

  onLoadedMetadata(audio: HTMLAudioElement): void {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      this.elementDuration.set(audio.duration);
    }
  }

  seek(event: MouseEvent, audio: HTMLAudioElement): void {
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    if (!rect.width) return;

    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );

    const total = this.duration();
    if (!total) return;

    audio.currentTime = ratio * total;
    this.commit(audio.currentTime);
  }
}
