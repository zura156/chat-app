import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideFastForward,
  lucideMaximize,
  lucideMinimize,
  lucidePause,
  lucidePlay,
  lucideRewind,
  lucideRotateCcw,
  lucideTriangleAlert,
  lucideVolume,
  lucideVolume1,
  lucideVolume2,
  lucideVolumeX,
} from '@ng-icons/lucide';

import { NgTemplateOutlet } from '@angular/common';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { MediaPlayerSizesT } from '../../types/media-player-sizes.type';
import { FormatTimePipe } from '../../pipes/format-time.pipe';
import { VideoActionsT } from '../../interfaces/video-actions.interface';
import { AttachmentI } from '../../../features/messages/interfaces/message.interface';
import {
  SignedMediaService,
  mediaIdentity,
} from '../../services/signed-media.service';

const OVERLAY_INACTIVITY_MS = 2600;
const INDICATOR_MS = 600;
const SEEK_STEP_SECONDS = 5; // keyboard
const VOLUME_STEP = 0.05;
const VOLUME_STORAGE_KEY = 'video-player-volume';

@Component({
  selector: 'app-video-player',
  imports: [NgIcon, HlmIcon, FormatTimePipe, NgTemplateOutlet],
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
      lucideTriangleAlert,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './video-player.html',
  styleUrl: './video-player.css',
})
export class VideoPlayer implements AfterViewInit {
  // ── Public API (unchanged) ──────────────────────────────────────────────────
  video = input.required<Partial<AttachmentI>>();
  size = input<MediaPlayerSizesT>('sm');
  disableContainerClickToggle = input<boolean>(false);
  loaded = output<void>();

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly signedMedia = inject(SignedMediaService);

  readonly videoPlayer = viewChild<ElementRef<HTMLVideoElement>>('videoPlayer');
  readonly playerContainer =
    viewChild<ElementRef<HTMLDivElement>>('playerContainer');
  readonly timeline = viewChild<ElementRef<HTMLDivElement>>('timeline');

  // ── State ───────────────────────────────────────────────────────────────────
  readonly isPlaying = signal(false);
  readonly isEnded = signal(false);
  readonly isBuffering = signal(false);
  readonly hasError = signal(false);
  readonly isMuted = signal(false);
  readonly volume = signal(1);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly bufferedEnd = signal(0);
  readonly isFullscreen = signal(false);
  readonly isScrubbing = signal(false);
  readonly isOverlayVisible = signal(true);
  readonly showIndicator = signal(false);
  readonly indicatorType = signal<VideoActionsT>(null);

  /**
   * Coarse pointer means a touch-first device. `ontouchstart` alone is true on
   * touch-capable laptops, where hover controls are still the right UI.
   */
  readonly isTouch =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  private hideOverlayTimer?: ReturnType<typeof setTimeout>;
  private hideIndicatorTimer?: ReturnType<typeof setTimeout>;
  private lastVolumeBeforeMute = 1;
  private warnedAboutRanges = false;
  /** Bounds the silent re-sign to one attempt per player. See the error handler. */
  private autoRecoveryAttempted = false;

  /** Amount of the last skip, so the indicator matches the step actually used. */
  readonly seekAmount = signal(SEEK_STEP_SECONDS);

  // ── Derived ─────────────────────────────────────────────────────────────────
  readonly styleSize = computed<MediaPlayerSizesT>(() =>
    this.isFullscreen() ? 'lg' : this.size(),
  );

  readonly iconSize = computed(() => (this.styleSize() === 'lg' ? 'lg' : 'sm'));

  /** Whatever the input currently says, signature and all. */
  private readonly incomingSrc = computed(() => {
    const variants = this.video()?.variants;
    // `original` is the progressive mp4; `hls` only exists on legacy records
    return variants?.original || variants?.hls || '';
  });

  /**
   * The URL actually bound to the element, held steady across re-signing.
   *
   * Attachment URLs are presigned on the way out of the API against a
   * timestamp rounded down to the hour, so the same object yields a different
   * URL either side of an hour boundary. This was a plain `computed`, so any
   * refetch that crossed one — a page of history loading, an upload-ready
   * event, a conversation reopening — changed `[src]`, and changing the `src`
   * of a <video> makes the browser tear down and reload the media **from the
   * beginning**.
   *
   * That is the "some users can't watch the whole video" report: it depends on
   * how long the video is and when the viewer happened to start it, so it is
   * invisible on a short test clip and reproducible for someone watching
   * something long. The fix is to notice that a new signature for the same
   * object is not new media, and keep the URL the element already has.
   */
  readonly src = linkedSignal<string, string>({
    source: () => this.incomingSrc(),
    computation: (incoming, previous) => {
      const held = previous?.value;
      if (!held) return incoming;
      // An input that momentarily has no URL must not blank a playing element.
      if (!incoming) return held;
      return mediaIdentity(incoming) === mediaIdentity(held) ? held : incoming;
    },
  });

  readonly poster = computed(
    () => this.video()?.variants?.thumbnail || this.video()?.variants?.thumb,
  );

  /** Live streams and not-yet-loaded metadata report Infinity/NaN. */
  readonly isSeekable = computed(() => {
    const duration = this.duration();
    return Number.isFinite(duration) && duration > 0;
  });

  readonly progressPercentage = computed(() =>
    this.isSeekable() ? (this.currentTime() / this.duration()) * 100 : 0,
  );

  readonly bufferedPercentage = computed(() =>
    this.isSeekable()
      ? Math.min(100, (this.bufferedEnd() / this.duration()) * 100)
      : 0,
  );

  /** Controls stay up whenever playback is not running. */
  readonly controlsVisible = computed(
    () =>
      this.isOverlayVisible() ||
      !this.isPlaying() ||
      this.isScrubbing() ||
      this.hasError(),
  );

  ngAfterViewInit(): void {
    const el = this.videoPlayer()?.nativeElement;
    if (!el) return;

    this.restoreVolume(el);
    this.isFullscreen.set(!!this.fullscreenElement());

    // Media state is read from the element's own events rather than inferred.
    // The previous version compared `currentTime === duration` to detect the
    // end, which is float equality and routinely missed.
    const on = <K extends keyof HTMLMediaElementEventMap>(
      type: K,
      handler: (event: HTMLMediaElementEventMap[K]) => void,
    ) => {
      el.addEventListener(type, handler);
      this.destroyRef.onDestroy(() => el.removeEventListener(type, handler));
    };

    on('loadedmetadata', () => {
      this.duration.set(el.duration);
      this.hasError.set(false);
      // emitted early so hosts that hide the player until `loaded` reveal it as
      // soon as there is something to show
      this.loaded.emit();
    });
    on('durationchange', () => this.duration.set(el.duration));
    on('timeupdate', () => {
      if (!this.isScrubbing()) this.currentTime.set(el.currentTime);
      this.updateBuffered(el);
    });
    on('progress', () => this.updateBuffered(el));
    on('play', () => {
      this.isPlaying.set(true);
      this.isEnded.set(false);
      this.flashIndicator('play');
      this.scheduleOverlayHide();
    });
    on('pause', () => {
      this.isPlaying.set(false);
      this.flashIndicator('pause');
      this.revealOverlay();
    });
    on('ended', () => {
      this.isEnded.set(true);
      this.isPlaying.set(false);
      this.revealOverlay();
    });
    on('waiting', () => this.isBuffering.set(true));
    on('playing', () => {
      this.isBuffering.set(false);
      this.isPlaying.set(true);
    });
    on('canplay', () => this.isBuffering.set(false));
    on('volumechange', () => {
      this.volume.set(el.volume);
      this.isMuted.set(el.muted);
      this.persistVolume(el);
    });
    on('error', () => {
      // otherwise a host waiting on `loaded` spins forever
      this.loaded.emit();

      /*
       * Try once to recover silently before showing a failure.
       *
       * By far the most common cause of a mid-playback error is a presigned URL
       * that expired while the tab was open, and the fix for that is a fresh
       * signature — something the user cannot supply and should not have to
       * think about. Bounded to a single attempt so a genuinely broken object
       * surfaces as an error instead of looping.
       */
      if (!this.autoRecoveryAttempted && this.video()?.uploadId) {
        this.autoRecoveryAttempted = true;
        this.retry();
        return;
      }

      this.hasError.set(true);
      this.isBuffering.set(false);
    });

    // iOS enters fullscreen through the video element itself, which does not
    // fire the standard fullscreenchange event.
    const onBeginFs = () => this.isFullscreen.set(true);
    const onEndFs = () => this.isFullscreen.set(false);
    el.addEventListener('webkitbeginfullscreen', onBeginFs);
    el.addEventListener('webkitendfullscreen', onEndFs);

    const onFsChange = () => this.isFullscreen.set(!!this.fullscreenElement());
    for (const evt of [
      'fullscreenchange',
      'webkitfullscreenchange',
      'mozfullscreenchange',
      'MSFullscreenChange',
    ]) {
      this.document.addEventListener(evt, onFsChange);
    }

    this.destroyRef.onDestroy(() => {
      el.removeEventListener('webkitbeginfullscreen', onBeginFs);
      el.removeEventListener('webkitendfullscreen', onEndFs);
      for (const evt of [
        'fullscreenchange',
        'webkitfullscreenchange',
        'mozfullscreenchange',
        'MSFullscreenChange',
      ]) {
        this.document.removeEventListener(evt, onFsChange);
      }
      clearTimeout(this.hideOverlayTimer);
      clearTimeout(this.hideIndicatorTimer);
    });
  }

  // ── Playback ────────────────────────────────────────────────────────────────

  togglePlayback(): void {
    const el = this.videoPlayer()?.nativeElement;
    if (!el) return;

    if (el.paused || el.ended) {
      // play() rejects on autoplay policy violations and when a pause()
      // interrupts it; an unhandled rejection logs a console error either way
      el.play()?.catch((error: DOMException) => {
        if (error?.name !== 'AbortError') {
          console.warn('Video playback was blocked:', error);
        }
      });
    } else {
      el.pause();
    }
  }

  /** Public: hosts pause the inline player before opening the full viewer. */
  pauseVideo(): void {
    const el = this.videoPlayer()?.nativeElement;
    if (el && !el.paused) el.pause();
  }

  replay(): void {
    const el = this.videoPlayer()?.nativeElement;
    if (!el) return;
    el.currentTime = 0;
    this.isEnded.set(false);
    this.togglePlayback();
  }

  /**
   * Recovers from a playback failure.
   *
   * This used to be `el.load()` on the same URL, which is precisely the thing
   * that had just failed. The overwhelmingly common cause is an expired
   * signature — the URL was minted when the message was fetched and has a fixed
   * lifetime — so the first thing to try is a fresh one. Only if that is
   * unavailable do we fall back to reloading what we have, which still helps
   * for a transient network failure.
   */
  retry(): void {
    const el = this.videoPlayer()?.nativeElement;
    if (!el) return;

    this.hasError.set(false);
    this.isBuffering.set(true);

    const uploadId = this.video()?.uploadId;
    if (!uploadId) {
      this.reload(el, this.incomingSrc() || this.src());
      return;
    }

    this.signedMedia.invalidate(uploadId);
    this.signedMedia
      .refresh(uploadId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((variants) => {
        const fresh = variants?.['original'] || variants?.['hls'];
        this.reload(el, fresh || this.incomingSrc() || this.src());
      });
  }

  /**
   * Points the element at a URL and restores the playhead.
   *
   * Assigning `src` resets `currentTime` to zero, so the position is captured
   * first and put back once the new source has enough metadata to accept a
   * seek — otherwise recovering from a failure would silently cost the viewer
   * their place, which is the same complaint this fix exists to answer.
   */
  private reload(el: HTMLVideoElement, url: string): void {
    const resumeAt = el.currentTime;
    const wasPlaying = !el.paused;

    this.src.set(url);
    el.src = url;
    el.load();

    const onLoaded = () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      if (resumeAt > 0 && Number.isFinite(el.duration)) {
        el.currentTime = Math.min(resumeAt, el.duration);
      }
      if (wasPlaying) el.play()?.catch(() => {});
    };
    el.addEventListener('loadedmetadata', onLoaded);
  }

  seekBy(seconds: number): void {
    const el = this.videoPlayer()?.nativeElement;
    if (!el || !this.isSeekable()) return;

    this.seekAmount.set(Math.abs(seconds));
    this.applySeek(el, el.currentTime + seconds);
    this.flashIndicator(seconds > 0 ? 'forward' : 'backward');
  }

  /**
   * Chrome only honours a seek to a position the media element reports as
   * seekable, and it populates `seekable` exclusively from responses that
   * support HTTP Range (206 Partial Content). A host that answers every request
   * with a plain 200 therefore produces a video that plays but cannot be
   * scrubbed — in Chrome. Firefox buffers the whole resource and seeks inside
   * `buffered` regardless, which is why the same file behaves differently.
   *
   * We still attempt the seek (a later range response can populate `seekable`),
   * but fall back to `buffered`, which Chrome does honour, and say plainly what
   * is wrong the first time it fails.
   */
  private applySeek(el: HTMLVideoElement, seconds: number): void {
    const duration = this.duration();
    const target = Math.max(
      0,
      Math.min(Number.isFinite(duration) ? duration : seconds, seconds),
    );

    const clamped = this.clampToRanges(el.seekable, target);
    const finalTarget =
      clamped ?? this.clampToRanges(el.buffered, target) ?? target;

    if (!el.seekable.length && !this.warnedAboutRanges) {
      this.warnedAboutRanges = true;
      console.warn(
        '[video-player] The media element reports no seekable ranges. ' +
          'The host is most likely not answering HTTP Range requests with ' +
          '206 Partial Content, which prevents seeking in Chromium browsers.',
      );
    }

    el.currentTime = finalTarget;
    this.currentTime.set(finalTarget);
  }

  /** Nearest position inside one of the ranges, or null if there are none. */
  private clampToRanges(ranges: TimeRanges, target: number): number | null {
    if (!ranges?.length) return null;

    for (let i = 0; i < ranges.length; i++) {
      if (target >= ranges.start(i) && target <= ranges.end(i)) return target;
    }

    // outside every range — snap to the closest edge so the seek still moves
    let closest = ranges.start(0);
    let smallestGap = Infinity;

    for (let i = 0; i < ranges.length; i++) {
      for (const edge of [ranges.start(i), ranges.end(i)]) {
        const gap = Math.abs(edge - target);
        if (gap < smallestGap) {
          smallestGap = gap;
          closest = edge;
        }
      }
    }
    return closest;
  }

  // ── Timeline ────────────────────────────────────────────────────────────────

  private seekToClientX(clientX: number): void {
    const track = this.timeline()?.nativeElement;
    const el = this.videoPlayer()?.nativeElement;
    if (!track || !el || !this.isSeekable()) return;

    const rect = track.getBoundingClientRect();
    if (!rect.width) return;

    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

    // routed through applySeek so dragging gets the same seekable/buffered
    // fallback as every other seek — assigning currentTime directly is exactly
    // the write Chrome silently discards when there are no seekable ranges
    this.applySeek(el, ratio * this.duration());
  }

  /**
   * Pointer events cover mouse, touch and pen in one path — this was
   * mousedown/mousemove only, so the timeline could not be scrubbed by finger.
   * Pointer capture keeps the drag alive when the finger leaves the thin track.
   */
  onTimelinePointerDown(event: PointerEvent): void {
    if (!this.isSeekable()) return;
    event.preventDefault();
    event.stopPropagation();

    this.isScrubbing.set(true);
    this.seekToClientX(event.clientX);

    const track = event.currentTarget as HTMLElement;
    track.setPointerCapture?.(event.pointerId);

    const onMove = (moveEvent: PointerEvent) =>
      this.seekToClientX(moveEvent.clientX);

    const onUp = () => {
      this.isScrubbing.set(false);
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
      this.scheduleOverlayHide();
    };

    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);
  }

  onTimelineKeydown(event: KeyboardEvent): void {
    if (!this.isSeekable()) return;

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.seekBy(-SEEK_STEP_SECONDS);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.seekBy(SEEK_STEP_SECONDS);
        break;
      case 'Home':
        event.preventDefault();
        this.seekTo(0);
        break;
      case 'End':
        event.preventDefault();
        this.seekTo(this.duration());
        break;
    }
  }

  private seekTo(seconds: number): void {
    const el = this.videoPlayer()?.nativeElement;
    if (!el) return;
    this.applySeek(el, seconds);
  }

  // ── Volume ──────────────────────────────────────────────────────────────────

  setVolume(event: Event): void {
    const el = this.videoPlayer()?.nativeElement;
    const value = Number((event.target as HTMLInputElement).value);
    if (!el || Number.isNaN(value)) return;

    el.muted = value === 0;
    el.volume = value; // volumechange syncs the signals back
  }

  toggleMute(): void {
    const el = this.videoPlayer()?.nativeElement;
    if (!el) return;

    if (!el.muted && el.volume > 0) this.lastVolumeBeforeMute = el.volume;

    el.muted = !el.muted;
    if (!el.muted && el.volume === 0) {
      el.volume = this.lastVolumeBeforeMute || 1;
    }
    this.flashIndicator('volume-change');
  }

  private adjustVolume(delta: number): void {
    const el = this.videoPlayer()?.nativeElement;
    if (!el) return;

    el.volume = Math.max(0, Math.min(1, el.volume + delta));
    if (el.volume > 0) el.muted = false;
    this.flashIndicator('volume-change');
  }

  onVolumeWheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.adjustVolume(Math.sign(event.deltaY) * -VOLUME_STEP);
  }

  private restoreVolume(el: HTMLVideoElement): void {
    try {
      const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
      if (stored !== null) {
        const value = Math.max(0, Math.min(1, Number(stored)));
        if (!Number.isNaN(value)) el.volume = value;
      }
    } catch {
      // storage can throw in private mode — a default volume is fine
    }
    this.volume.set(el.volume);
    this.isMuted.set(el.muted);
    this.lastVolumeBeforeMute = el.volume || 1;
  }

  private persistVolume(el: HTMLVideoElement): void {
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(el.volume));
    } catch {
      // ignore
    }
  }

  // ── Fullscreen ──────────────────────────────────────────────────────────────

  toggleFullscreen(): void {
    if (this.isFullscreen()) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  }

  private fullscreenElement(): Element | null {
    const doc = this.document as any;
    return (
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement ||
      null
    );
  }

  private enterFullscreen(): void {
    const container = this.playerContainer()?.nativeElement as any;
    const video = this.videoPlayer()?.nativeElement as any;

    try {
      // iPhone implements the Fullscreen API on the video element only — never
      // on a container div — so the button did nothing there.
      if (!container?.requestFullscreen && video?.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
        return;
      }

      const request =
        container?.requestFullscreen ||
        container?.webkitRequestFullscreen ||
        container?.mozRequestFullScreen ||
        container?.msRequestFullscreen;

      request?.call(container);
    } catch (error) {
      console.warn('Fullscreen request failed:', error);
    }
  }

  private exitFullscreen(): void {
    const doc = this.document as any;
    const video = this.videoPlayer()?.nativeElement as any;

    try {
      if (!doc.exitFullscreen && video?.webkitExitFullscreen) {
        video.webkitExitFullscreen();
        return;
      }

      const exit =
        doc.exitFullscreen ||
        doc.webkitExitFullscreen ||
        doc.mozCancelFullScreen ||
        doc.msExitFullscreen;

      exit?.call(doc);
    } catch (error) {
      console.warn('Exit fullscreen failed:', error);
    }
  }

  // ── Overlay / pointer ───────────────────────────────────────────────────────

  onPointerEnter(): void {
    if (this.isTouch) return;
    this.revealOverlay();
  }

  onPointerLeave(): void {
    if (this.isTouch || this.isScrubbing()) return;
    this.isOverlayVisible.set(false);
    clearTimeout(this.hideOverlayTimer);
  }

  onPointerMove(): void {
    if (this.isTouch) return;
    this.revealOverlay();
  }

  /**
   * Touch: first tap reveals the controls, a second toggles playback — matching
   * native players. Pointer devices keep click-to-toggle.
   */
  onContainerClick(): void {
    if (this.hasError()) return;

    if (this.isTouch) {
      if (!this.controlsVisible()) {
        this.revealOverlay();
        return;
      }
      if (!this.disableContainerClickToggle()) this.togglePlayback();
      this.scheduleOverlayHide();
      return;
    }

    if (!this.disableContainerClickToggle()) this.togglePlayback();
  }

  onKeydown(event: KeyboardEvent): void {
    // never swallow keys meant for a focused control
    const target = event.target as HTMLElement;
    if (target?.tagName === 'INPUT' || target?.closest('[role="slider"]')) {
      return;
    }

    switch (event.key) {
      case ' ':
      case 'k':
        event.preventDefault();
        this.togglePlayback();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.seekBy(-SEEK_STEP_SECONDS);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.seekBy(SEEK_STEP_SECONDS);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.adjustVolume(VOLUME_STEP);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.adjustVolume(-VOLUME_STEP);
        break;
      case 'm':
        event.preventDefault();
        this.toggleMute();
        break;
      case 'f':
        event.preventDefault();
        this.toggleFullscreen();
        break;
      default:
        return;
    }

    this.revealOverlay();
  }

  private revealOverlay(): void {
    this.isOverlayVisible.set(true);
    this.scheduleOverlayHide();
  }

  private scheduleOverlayHide(): void {
    clearTimeout(this.hideOverlayTimer);
    this.hideOverlayTimer = setTimeout(() => {
      if (this.isScrubbing()) return;
      this.isOverlayVisible.set(false);
    }, OVERLAY_INACTIVITY_MS);
  }

  private flashIndicator(type: VideoActionsT): void {
    this.indicatorType.set(type);
    this.showIndicator.set(true);
    clearTimeout(this.hideIndicatorTimer);
    this.hideIndicatorTimer = setTimeout(
      () => this.showIndicator.set(false),
      INDICATOR_MS,
    );
  }

  private updateBuffered(el: HTMLVideoElement): void {
    const buffered = el.buffered;
    if (!buffered.length) return;

    // the range that contains the playhead, not simply the last one
    for (let i = 0; i < buffered.length; i++) {
      if (
        buffered.start(i) <= el.currentTime &&
        buffered.end(i) >= el.currentTime
      ) {
        this.bufferedEnd.set(buffered.end(i));
        return;
      }
    }
    this.bufferedEnd.set(buffered.end(buffered.length - 1));
  }
}
