import {
  Component,
  computed,
  ElementRef,
  OnDestroy,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucidePause,
  lucidePlay,
  lucideSquare,
  lucideTrash2,
} from '@ng-icons/lucide';

import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { OnInit } from '@angular/core';
import { RecordingResult } from '../../interfaces/audio-message.interface';
import { FormatTimePipe } from '../../pipes/format-time.pipe';

const BAR_COUNT = 28;
// ~20fps. requestAnimationFrame runs inside the Angular zone, so sampling on
// every frame triggers a change-detection pass 60x/second for the whole app
// while recording — and the meter looks no better for it.
const LEVEL_SAMPLE_MS = 50;

@Component({
  selector: 'app-audio-recorder',
  templateUrl: './audio-recorder.html',
  imports: [NgIcon, HlmButton, HlmIcon, FormatTimePipe],
  providers: [
    provideIcons({
      lucideTrash2,
      lucideSquare,
      lucidePlay,
      lucidePause,
    }),
  ],
})
export class AudioRecorder implements OnInit, OnDestroy {
  recordingDone = output<RecordingResult>();
  recordingDeleted = output<void>();
  isMicAllowed = output<boolean>();

  @ViewChild('record') record!: ElementRef<HTMLDivElement>;

  private readonly TIME_LIMIT = 60; // seconds
  private timerId: any;
  private rafId?: number;
  private lastLevelAt = 0;
  private audioContext: AudioContext;
  private analyser?: AnalyserNode;
  private streamSource?: MediaStreamAudioSourceNode;
  private stream?: MediaStream;
  private destroyed = false;
  /** container the browser agreed to record in; '' means browser default */
  mimeType = '';

  mediaRecorder?: MediaRecorder;
  recordingTime = signal<number>(0);
  audioUrl = signal<string>('');

  // Live mic amplitude while recording — real signal via AnalyserNode, not faked.
  readonly liveLevels = signal<number[]>([]);

  // Real peaks extracted from the decoded recording, shown once stopped.
  readonly previewBars = signal<number[]>([]);
  readonly previewDuration = signal<number>(0);
  readonly previewCurrentTime = signal<number>(0);
  readonly previewProgress = computed(() =>
    this.previewDuration() > 0
      ? this.previewCurrentTime() / this.previewDuration()
      : 0,
  );
  readonly previewPlayedBars = computed(() =>
    Math.round(this.previewProgress() * this.previewBars().length),
  );

  constructor() {
    // Initialize AudioContext once.
    this.audioContext = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
  }

  async ngOnInit() {
    await this.startRecording();
  }

  async startRecording() {
    if (this.mediaRecorder) {
      return;
    }

    let stream: MediaStream | undefined;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.isMicAllowed.emit(true);
      this.stream = stream;

      // Safari/iOS has no webm encoder — hardcoding it threw NotSupportedError,
      // which the catch below reported as "microphone denied"
      this.mimeType = pickSupportedMimeType();
      this.mediaRecorder = this.mimeType
        ? new MediaRecorder(stream, { mimeType: this.mimeType })
        : new MediaRecorder(stream);

      let recordingStartTime = Date.now();
      let chunks: Blob[] = [];

      // Start the visual timer for user feedback
      this.timerId = setInterval(() => {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        this.recordingTime.set(elapsed);
        if (elapsed >= this.TIME_LIMIT) {
          this.stopRecording();
        }
      }, 100);

      await this.startLiveLevels(stream);

      this.mediaRecorder.ondataavailable = (e) => {
        chunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        clearInterval(this.timerId); // Stop visual timer
        this.stopLiveLevels();

        // release the mic first — do not leave the recording indicator on if
        // anything below throws
        this.releaseStream();

        const blob = new Blob(chunks, {
          type: this.mimeType || 'audio/webm',
        });
        this.setAudioUrl(URL.createObjectURL(blob));

        if (this.destroyed) return;

        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer =
            await this.audioContext.decodeAudioData(arrayBuffer);
          const accurateDuration = audioBuffer.duration;

          this.previewDuration.set(accurateDuration);
          this.previewBars.set(extractPeaks(audioBuffer, BAR_COUNT));

          this.recordingDone.emit({ blob, duration: accurateDuration });
        } catch (error) {
          console.error('Failed to decode audio and get duration:', error);
          // fall back to the wall-clock timer so the preview still shows
          // something sensible instead of 0:00 and a flat line
          this.previewDuration.set(this.recordingTime());
          this.previewBars.set(new Array(BAR_COUNT).fill(0.3));
          this.recordingDone.emit({ blob, duration: this.recordingTime() });
        }
      };

      this.mediaRecorder.start();
    } catch (error) {
      console.error('Could not start recording:', error);
      // getUserMedia may have resolved before MediaRecorder threw
      this.stopLiveLevels();
      this.releaseStream();
      this.isMicAllowed.emit(false);
    }
  }

  private async startLiveLevels(stream: MediaStream): Promise<void> {
    // Browsers start the context suspended until a user gesture; a suspended
    // context reads as pure silence, so the meter would never move.
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }

    this.streamSource = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.streamSource.connect(this.analyser); // analysis only — never connect to destination (feedback)

    const data = new Uint8Array(this.analyser.frequencyBinCount);

    const tick = () => {
      if (!this.analyser) return;
      this.rafId = requestAnimationFrame(tick);

      const now = performance.now();
      if (now - this.lastLevelAt < LEVEL_SAMPLE_MS) return;
      this.lastLevelAt = now;

      this.analyser.getByteTimeDomainData(data);

      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const centered = (data[i] - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const level = Math.max(0.08, Math.min(1, rms * 4)); // gain up quiet mics

      this.liveLevels.update((levels) => {
        const next = [...levels, level];
        return next.length > BAR_COUNT ? next.slice(-BAR_COUNT) : next;
      });
    };
    tick();
  }

  private stopLiveLevels(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
    this.streamSource?.disconnect();
    this.analyser?.disconnect();
    this.streamSource = undefined;
    this.analyser = undefined;
  }

  onPreviewTimeUpdate(audio: HTMLAudioElement): void {
    this.previewCurrentTime.set(audio.currentTime);
  }

  seekPreview(event: MouseEvent, audio: HTMLAudioElement): void {
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    // element metadata is the more reliable source once it has loaded
    const total = Number.isFinite(audio.duration)
      ? audio.duration
      : this.previewDuration();
    audio.currentTime = ratio * total;
    this.previewCurrentTime.set(audio.currentTime);
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder?.stop();
    }
  }

  deleteRecording(): void {
    if (this.mediaRecorder) {
      this.stopRecording();
    }
    this.mediaRecorder = undefined;
    clearInterval(this.timerId);
    this.stopLiveLevels();
    this.releaseStream();
    this.setAudioUrl('');

    // reset the meter, otherwise the next recording starts with the previous
    // take's waveform still on screen
    this.liveLevels.set([]);
    this.previewBars.set([]);
    this.previewDuration.set(0);
    this.previewCurrentTime.set(0);
    this.recordingTime.set(0);

    this.recordingDeleted.emit();
  }

  /** Stop the mic tracks; onstop is not guaranteed to run in every path. */
  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }

  private setAudioUrl(url: string): void {
    const previous = this.audioUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.audioUrl.set(url);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.deleteRecording();
    if (this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }
}

/** First MediaRecorder container the browser actually supports. */
function pickSupportedMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4', // Safari
    'audio/mpeg',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function extractPeaks(buffer: AudioBuffer, bars: number): number[] {
  const data = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / bars));
  const peaks: number[] = [];

  for (let i = 0; i < bars; i++) {
    const start = i * blockSize;
    let sum = 0;
    for (let j = 0; j < blockSize && start + j < data.length; j++) {
      sum += Math.abs(data[start + j]);
    }
    peaks.push(sum / blockSize);
  }

  const max = Math.max(...peaks, 0.0001);
  return peaks.map((p) => Math.max(0.12, p / max));
}
