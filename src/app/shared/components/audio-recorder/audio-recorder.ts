import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideMicOff,
  lucidePause,
  lucidePlay,
  lucideSquare,
  lucideTrash2,
} from '@ng-icons/lucide';

import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { RecordingResult } from '../../interfaces/audio-message.interface';
import { FormatTimePipe } from '../../pipes/format-time.pipe';

const BAR_COUNT = 28;
/** Resting bar height, so a silent meter still reads as a meter. */
const IDLE_LEVEL = 0.1;

/**
 * Where the recorder is in its lifecycle.
 *
 * This used to be derived in the template from `mediaRecorder?.state`, a plain
 * property on a non-signal object. In a zoneless app nothing schedules change
 * detection when that value changes, so the UI only repainted because unrelated
 * signals happened to be ticking at the time — and any path that stopped those
 * ticks before the state settled left the component rendering nothing at all.
 * The state is now the signal, and the MediaRecorder is an implementation
 * detail behind it.
 */
type RecorderStatus = 'starting' | 'recording' | 'stopped' | 'error';

/**
 * One AudioContext for the whole page, created on first use.
 *
 * Browsers cap the number of live hardware contexts (Chrome allows six), and
 * this component used to construct one per instance in its *constructor* — the
 * one place a throw is fatal, because it happens before the component exists.
 * Opening the recorder a handful of times in a session was enough to reach the
 * cap, after which pressing the microphone button did nothing whatsoever and
 * only a page reload recovered.
 *
 * It is deliberately never closed: it is shared, and it costs nothing idle.
 */
let sharedAudioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
    return sharedAudioContext;
  }
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    sharedAudioContext = new Ctor();
    return sharedAudioContext;
  } catch {
    return null;
  }
};

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
      lucideMicOff,
    }),
  ],
})
export class AudioRecorder implements OnInit, OnDestroy {
  recordingDone = output<RecordingResult>();
  recordingDeleted = output<void>();
  /** False when the microphone could not be opened, for any reason. */
  isMicAllowed = output<boolean>();

  private readonly TIME_LIMIT = 60; // seconds
  private timerId?: ReturnType<typeof setInterval>;
  private rafId?: number;
  private analyser?: AnalyserNode;
  private streamSource?: MediaStreamAudioSourceNode;
  private stream?: MediaStream;
  private mediaRecorder?: MediaRecorder;
  private destroyed = false;

  /**
   * Identifies the current take, so a `finalize` already in flight can tell
   * that it belongs to a recording the user has since discarded.
   *
   * Detaching `onstop` closes the gap before `finalize` starts; this closes the
   * one inside it. Decoding the waveform is asynchronous and takes long enough
   * on a long clip to press the discard button during, and the emit at the end
   * would otherwise still hand the blob to the parent.
   *
   * A counter rather than a boolean: discarding and immediately starting a new
   * take would reset a flag back to "live" and let the abandoned finalize
   * through on the new take's ticket.
   */
  private takeId = 0;

  /** Container the browser agreed to record in; '' means browser default. */
  private mimeType = '';

  readonly status = signal<RecorderStatus>('starting');
  readonly errorMessage = signal<string | null>(null);

  recordingTime = signal<number>(0);
  audioUrl = signal<string>('');

  /**
   * The meter's bars. Fixed identity, so `@for` renders them once and never
   * again — the heights are written straight to the DOM (see `paintMeter`).
   */
  readonly barSlots = Array.from({ length: BAR_COUNT }, (_, index) => index);

  /** The bars' container, so their heights can be written without a re-render. */
  private readonly meter = viewChild<ElementRef<HTMLDivElement>>('meter');

  /**
   * Live mic amplitude — a real reading via AnalyserNode, not faked.
   *
   * Held in a plain array rather than a signal, and seeded flat rather than
   * empty. It used to be `signal<number[]>([])`, rebuilt with
   * `[...levels, level].slice(-BAR_COUNT)` twenty times a second, which cost
   * a full application change-detection pass per sample and started every
   * recording with an empty strip that filled in from the left.
   */
  private readonly levels = new Float32Array(BAR_COUNT).fill(IDLE_LEVEL);

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

  /** True once there is something to play back. */
  readonly hasPreview = computed(
    () => this.status() === 'stopped' && !!this.audioUrl(),
  );

  async ngOnInit(): Promise<void> {
    await this.startRecording();
  }

  async startRecording(): Promise<void> {
    if (this.mediaRecorder) return;

    /*
     * Checked explicitly, because the failure is otherwise indistinguishable
     * from a denied permission.
     *
     * `navigator.mediaDevices` is *undefined* on an insecure origin — plain
     * http on a LAN address, which is exactly how this gets tested — so
     * `getUserMedia` threw a TypeError that the catch below reported as
     * "microphone denied". The user was told to check a permission that was
     * never asked for.
     */
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.fail(
        'Recording needs a secure connection. Open the app over https (or on localhost).',
      );
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      this.fail("This browser can't record audio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // The component can be torn down while the permission prompt is open.
      if (this.destroyed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      this.isMicAllowed.emit(true);

      // Safari/iOS has no webm encoder — hardcoding it threw NotSupportedError,
      // which the catch below reported as "microphone denied".
      this.mimeType = pickSupportedMimeType();
      this.mediaRecorder = this.mimeType
        ? new MediaRecorder(stream, { mimeType: this.mimeType })
        : new MediaRecorder(stream);

      const recordingStartTime = Date.now();
      const chunks: Blob[] = [];

      this.timerId = setInterval(() => {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        this.recordingTime.set(elapsed);
        if (elapsed >= this.TIME_LIMIT) this.stopRecording();
      }, 100);

      this.startLiveLevels(stream);

      this.mediaRecorder.ondataavailable = (event) => chunks.push(event.data);

      // MediaRecorder reports encoder failures here rather than by rejecting.
      this.mediaRecorder.onerror = () => {
        this.fail('Recording stopped unexpectedly.');
        this.teardownCapture();
      };

      const take = ++this.takeId;
      this.mediaRecorder.onstop = () => {
        void this.finalize(chunks, take);
      };

      this.mediaRecorder.start();
      this.status.set('recording');
    } catch (error) {
      this.fail(describeMicError(error));
    }
  }

  /**
   * Turns the captured chunks into a playable preview and hands the blob up.
   *
   * Every step that can throw is contained: the recording itself is already
   * safe on disk at this point, and failing to decode a waveform for the
   * preview must not cost the user their voice note.
   */
  private async finalize(chunks: Blob[], take: number): Promise<void> {
    /** True once this take has been discarded, destroyed, or superseded. */
    const abandoned = () => this.destroyed || this.takeId !== take;

    if (this.timerId) clearInterval(this.timerId);
    this.stopLiveLevels();
    // Release the mic first — do not leave the browser's recording indicator
    // on if anything below throws.
    this.releaseStream();

    if (abandoned()) return;

    const blob = new Blob(chunks, { type: this.mimeType || 'audio/webm' });

    // An empty blob means nothing was captured: a muted device, or a stop that
    // arrived before the first chunk. Presenting a 0-byte "recording" the user
    // can send is worse than saying so.
    if (blob.size === 0) {
      this.fail('Nothing was recorded. Check that your microphone is not muted.');
      return;
    }

    this.setAudioUrl(URL.createObjectURL(blob));
    this.status.set('stopped');

    const context = getAudioContext();
    try {
      if (!context) throw new Error('No AudioContext');
      const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());

      // Decoding a long clip is slow enough to discard during.
      if (abandoned()) return;

      this.previewDuration.set(audioBuffer.duration);
      this.previewBars.set(extractPeaks(audioBuffer, BAR_COUNT));
      this.recordingDone.emit({ blob, duration: audioBuffer.duration });
    } catch {
      if (abandoned()) return;
      // Fall back to the wall-clock timer so the preview shows something
      // sensible instead of 0:00 and a flat line. The recording is still fine.
      this.previewDuration.set(this.recordingTime());
      this.previewBars.set(new Array(BAR_COUNT).fill(0.3));
      this.recordingDone.emit({ blob, duration: this.recordingTime() });
    }
  }

  /** Reports a failure to the user *and* to the host, and stops. */
  private fail(message: string): void {
    this.teardownCapture();
    this.errorMessage.set(message);
    this.status.set('error');
    this.isMicAllowed.emit(false);
  }

  private startLiveLevels(stream: MediaStream): void {
    const context = getAudioContext();
    // The meter is decorative; losing it must not stop the recording.
    if (!context) return;

    // Browsers start a context suspended until a user gesture, and a suspended
    // context reads as pure silence — so the meter would never move.
    if (context.state === 'suspended') void context.resume().catch(() => {});

    try {
      this.streamSource = context.createMediaStreamSource(stream);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      // Analysis only — never connect to destination, that is a feedback loop.
      this.streamSource.connect(this.analyser);
    } catch {
      this.stopLiveLevels();
      return;
    }

    const data = new Uint8Array(this.analyser.frequencyBinCount);

    /*
     * Sampled every frame, and painted directly onto the DOM nodes.
     *
     * This was throttled to 20fps and pushed through a signal, with each bar
     * carrying `transition-[height] duration-75`. That combination is what made
     * the meter judder. The strip *scrolls* — every 50ms each bar takes over
     * its neighbour's value — so the transition was animating all 28 bars
     * toward a different sample's height, and because 75ms is longer than the
     * 50ms between samples, every bar was permanently mid-animation chasing a
     * target that had already moved. CSS was interpolating between two readings
     * that have nothing to do with each other.
     *
     * A level meter's motion should come from the data, not from CSS easing
     * between samples. Per-frame readings with no transition give exactly that,
     * and writing the heights here rather than through a signal keeps sixty
     * change-detection passes a second out of the whole application while
     * someone is holding down the microphone button.
     */
    const tick = () => {
      if (!this.analyser) return;
      this.rafId = requestAnimationFrame(tick);

      this.analyser.getByteTimeDomainData(data);

      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const centered = (data[i] - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const level = Math.max(IDLE_LEVEL, Math.min(1, rms * 4)); // gain up quiet mics

      // Shift left by one and append: the newest reading enters on the right.
      this.levels.copyWithin(0, 1);
      this.levels[BAR_COUNT - 1] = level;

      this.paintMeter();
    };
    tick();
  }

  /**
   * Writes the current levels onto the bar elements.
   *
   * Deliberately outside Angular's rendering: these are 28 style writes on
   * elements whose structure never changes, sixty times a second. Routing that
   * through a signal would re-run change detection for the entire application
   * on every frame to produce the same DOM mutation.
   */
  private paintMeter(): void {
    const container = this.meter()?.nativeElement;
    if (!container) return;

    const bars = container.children;
    const count = Math.min(bars.length, BAR_COUNT);
    for (let i = 0; i < count; i++) {
      (bars[i] as HTMLElement).style.height = `${this.levels[i] * 100}%`;
    }
  }

  /** Flattens the meter, e.g. between takes. */
  private resetMeter(): void {
    this.levels.fill(IDLE_LEVEL);
    this.paintMeter();
  }

  private stopLiveLevels(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
    this.streamSource?.disconnect();
    this.analyser?.disconnect();
    this.streamSource = undefined;
    this.analyser = undefined;
  }

  /*
   * Preview playback is sampled per frame, like the live meter above and for
   * the same reason.
   *
   * `timeupdate` fires roughly four times a second, and the preview draws 28
   * bars over a clip that is usually only a few seconds long — so the fill
   * advanced two or three bars at a time on 250ms boundaries instead of moving.
   *
   * Unlike the meter this does go through signals: the bars' colour is a class
   * binding Angular owns, and the position only changes 28 times over the whole
   * clip. `commitPreview` writes only when the lit-bar count or the displayed
   * second actually changes, so a pass is scheduled a few dozen times per
   * playback rather than sixty times a second.
   */
  private previewRafId?: number;
  private lastPreviewBar = -1;
  private lastPreviewSecond = -1;

  onPreviewPlay(audio: HTMLAudioElement): void {
    this.stopPreviewTracking();

    const tick = () => {
      this.previewRafId = requestAnimationFrame(tick);

      const total = this.previewDuration();
      if (!total) return;

      const time = audio.currentTime;
      const bar = Math.round((time / total) * this.previewBars().length);
      const second = Math.floor(time);

      if (bar === this.lastPreviewBar && second === this.lastPreviewSecond) {
        return;
      }
      this.commitPreview(time);
    };
    tick();
  }

  onPreviewPause(audio: HTMLAudioElement): void {
    this.stopPreviewTracking();
    // Land exactly where the audio stopped, not on the last accepted sample.
    this.commitPreview(audio.currentTime);
  }

  onPreviewEnded(): void {
    this.stopPreviewTracking();
    this.commitPreview(this.previewDuration());
  }

  /**
   * Still bound, but only does anything when the frame loop is not running —
   * it is the one thing that reports a seek performed while paused.
   */
  onPreviewTimeUpdate(audio: HTMLAudioElement): void {
    if (this.previewRafId !== undefined) return;
    this.commitPreview(audio.currentTime);
  }

  private commitPreview(time: number): void {
    const total = this.previewDuration();
    this.lastPreviewBar = total
      ? Math.round((time / total) * this.previewBars().length)
      : -1;
    this.lastPreviewSecond = Math.floor(time);
    this.previewCurrentTime.set(time);
  }

  private stopPreviewTracking(): void {
    if (this.previewRafId !== undefined) {
      cancelAnimationFrame(this.previewRafId);
    }
    this.previewRafId = undefined;
  }

  seekPreview(event: MouseEvent, audio: HTMLAudioElement): void {
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    if (!rect.width) return;

    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    // Element metadata is the more reliable source once it has loaded.
    const total = Number.isFinite(audio.duration)
      ? audio.duration
      : this.previewDuration();
    audio.currentTime = ratio * total;
    // Through commitPreview, so the frame loop's "has anything changed?"
    // bookkeeping matches what is on screen — otherwise the first sample after
    // a seek can compare equal to the pre-seek position and be skipped.
    this.commitPreview(audio.currentTime);
  }

  stopRecording(): void {
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
  }

  deleteRecording(): void {
    this.teardownCapture();
    // The preview element is about to lose its source; nothing left to follow.
    this.stopPreviewTracking();
    this.setAudioUrl('');

    // Reset the meter, otherwise the next take starts with the previous one's
    // waveform still on screen.
    this.resetMeter();
    this.previewBars.set([]);
    this.previewDuration.set(0);
    this.previewCurrentTime.set(0);
    this.lastPreviewBar = -1;
    this.lastPreviewSecond = -1;
    this.recordingTime.set(0);
    this.errorMessage.set(null);

    this.recordingDeleted.emit();
  }

  /** Stops capture and frees the device, without touching the preview. */
  private teardownCapture(): void {
    /*
     * Detached unconditionally, and before the state check.
     *
     * This used to happen only in the `recording` branch, which misses the
     * window that matters: `stop()` dispatches its event asynchronously, after
     * the final `dataavailable`, so between pressing stop and `onstop` firing
     * the recorder is already `inactive`. The discard button is on screen the
     * whole time. Discarding in that window left the handler attached, and
     * `finalize` went on to publish — through `recordingDone` — the voice note
     * the user had just thrown away, after `recordingDeleted` had been emitted.
     */
    if (this.mediaRecorder) {
      this.mediaRecorder.onstop = null;
      if (this.mediaRecorder.state === 'recording') this.mediaRecorder.stop();
    }
    this.mediaRecorder = undefined;

    // Retires the current take, so a `finalize` already past its own guards
    // stops before it emits. The happy path does not come through here.
    this.takeId++;

    if (this.timerId) clearInterval(this.timerId);
    this.timerId = undefined;

    this.stopLiveLevels();
    this.releaseStream();
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
    this.teardownCapture();
    // A frame loop outlives the component unless it is cancelled, and this one
    // holds a reference to a detached <audio> element.
    this.stopPreviewTracking();
    this.setAudioUrl('');
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

/**
 * A message that names the actual problem.
 *
 * Everything here previously collapsed into one "microphone denied" branch,
 * which is only right for one of these cases and actively misleading for the
 * rest — a user with no microphone plugged in was sent to hunt through
 * permission settings.
 */
function describeMicError(error: unknown): string {
  const name = (error as DOMException | undefined)?.name;

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow it in your browser’s site settings.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found.';
    case 'NotReadableError':
      return 'Your microphone is in use by another app.';
    case 'AbortError':
      return 'The microphone could not be started.';
    default:
      return "Couldn't start recording.";
  }
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
