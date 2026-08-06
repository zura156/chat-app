import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioRecorder } from './audio-recorder';
import { RecordingResult } from '../../interfaces/audio-message.interface';

/*
 * Discarding a voice note has to actually discard it.
 *
 * `MediaRecorder.stop()` does not finish synchronously — it flushes a last
 * `dataavailable` and dispatches `stop` on a later task. The discard button is
 * on screen for that entire window, and for the decode that follows it, so
 * "press stop, change your mind, press the bin" is an ordinary sequence rather
 * than a contrived one. Both gaps used to end with `recordingDone` firing:
 * the parent attached and sent a recording the user had just thrown away,
 * after `recordingDeleted` had already told it not to.
 *
 * The two guards these cover are separate — one detaches the handler before
 * `finalize` can start, the other stops a `finalize` that is already inside its
 * own awaits — so they need separate tests.
 */

/** A MediaRecorder whose `stop` event fires only when the test says so. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  /**
   * Mirrors the real contract: the state flips immediately, the event does not.
   * Nothing here calls `onstop` — `flush()` is how a test closes that window.
   */
  stop(): void {
    this.state = 'inactive';
  }

  /** Delivers the final chunk and the stop event, as the browser eventually would. */
  flush(): void {
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

const track = () => ({ stop: vi.fn() });

/**
 * Decoding is the slow part of `finalize`, so it is the gap the second guard
 * exists for. Left null the decode resolves immediately; set, the test decides
 * when — which is the only way to be inside `finalize` when discard arrives.
 */
let pendingDecode: {
  promise: Promise<AudioBuffer>;
  resolve: (buffer: AudioBuffer) => void;
} | null = null;

const fakeAudioBuffer = {
  duration: 3,
  getChannelData: () => new Float32Array(1024).fill(0.5),
} as unknown as AudioBuffer;

const fakeAudioContext = {
  state: 'running',
  resume: async () => undefined,
  // The live meter is decorative and the component is explicit about losing it
  // gracefully; throwing here keeps a requestAnimationFrame loop out of the
  // tests without changing anything they assert.
  createMediaStreamSource: () => {
    throw new Error('no meter under test');
  },
  createAnalyser: () => {
    throw new Error('no meter under test');
  },
  decodeAudioData: () =>
    pendingDecode ? pendingDecode.promise : Promise.resolve(fakeAudioBuffer),
};

const deferDecode = () => {
  let resolve!: (buffer: AudioBuffer) => void;
  const promise = new Promise<AudioBuffer>((r) => (resolve = r));
  pendingDecode = { promise, resolve };
  return pendingDecode;
};

describe('AudioRecorder — discarding', () => {
  let fixture: ComponentFixture<AudioRecorder>;
  let component: AudioRecorder;
  let done: RecordingResult[];
  let deleted: number;
  let stopTrack: ReturnType<typeof track>;

  /** Lets every pending microtask settle, including finalize's awaits. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    FakeMediaRecorder.instances = [];
    stopTrack = track();

    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [stopTrack] })),
      },
    });
    /*
     * A real one is required, not a missing one. Without an AudioContext
     * `finalize` throws before its first `await` and runs start to finish
     * synchronously — there is no window to discard in, and the test that
     * matters most would pass against the unfixed code.
     *
     * The component caches a single context at module scope, so this has to be
     * the same object every test; behaviour is varied through `pendingDecode`
     * rather than by swapping the context.
     */
    pendingDecode = null;
    vi.stubGlobal(
      'AudioContext',
      function () {
        return fakeAudioContext;
      } as unknown as typeof AudioContext,
    );

    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();

    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });

    fixture = TestBed.createComponent(AudioRecorder);
    component = fixture.componentInstance;

    done = [];
    deleted = 0;
    component.recordingDone.subscribe((r) => done.push(r));
    component.recordingDeleted.subscribe(() => deleted++);

    fixture.detectChanges();
    await settle();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const recorder = () => FakeMediaRecorder.instances[0];

  it('starts recording once the microphone opens', async () => {
    expect(recorder()).toBeDefined();
    expect(recorder().state).toBe('recording');
    expect(component.status()).toBe('recording');
  });

  it('publishes the recording on the ordinary path', async () => {
    // The control: without this passing, the tests below would prove nothing.
    component.stopRecording();
    recorder().flush();
    await settle();

    expect(done).toHaveLength(1);
    expect(done[0].blob.size).toBeGreaterThan(0);
  });

  it('does not publish a recording discarded after stop', async () => {
    /*
     * The window between `stop()` and the `stop` event. The recorder is already
     * `inactive` here, which is exactly why guarding only the `recording` state
     * missed it.
     */
    component.stopRecording();
    expect(recorder().state).toBe('inactive');

    component.deleteRecording();
    recorder().flush();
    await settle();

    expect(deleted).toBe(1);
    expect(done).toEqual([]);
  });

  it('does not publish a recording discarded while it is being finalized', async () => {
    // The second window: `finalize` has begun and is suspended on the decode.
    const decode = deferDecode();

    component.stopRecording();
    recorder().flush();
    await settle(); // finalize is now waiting inside decodeAudioData

    component.deleteRecording();

    // The decode lands after the user has already thrown the take away.
    decode.resolve(fakeAudioBuffer);
    await settle();

    expect(deleted).toBe(1);
    expect(done).toEqual([]);
  });

  it('discards while still recording, without publishing', async () => {
    // The path that always worked; kept so a fix here cannot regress it.
    component.deleteRecording();
    await settle();

    expect(deleted).toBe(1);
    expect(done).toEqual([]);
    expect(recorder().state).toBe('inactive');
  });

  it('releases the microphone when discarded', async () => {
    // A live track is the browser's recording indicator staying on.
    component.deleteRecording();
    await settle();

    expect(stopTrack.stop).toHaveBeenCalled();
  });

  it('leaves nothing behind that could publish later', async () => {
    component.stopRecording();
    component.deleteRecording();

    // Whatever order the browser gets round to these in.
    recorder().flush();
    recorder().flush();
    await settle();

    expect(done).toEqual([]);
  });
});
