import {
  Component,
  ElementRef,
  linkedSignal,
  OnDestroy,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCirclePause,
  lucideCirclePlay,
  lucideCircleStop,
  lucideCircleX,
} from '@ng-icons/lucide';
import {
  BrnProgressComponent,
  BrnProgressIndicatorComponent,
} from '@spartan-ng/brain/progress';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { HlmProgressIndicatorDirective } from '@spartan-ng/ui-progress-helm';
import { OnInit } from '@angular/core';
import { RecordingResult } from '../../interfaces/audio-message.interface';

@Component({
  selector: 'app-audio-recorder',
  templateUrl: './audio-recorder.component.html',
  imports: [
    NgIcon,
    HlmButtonDirective,
    HlmIconDirective,
    BrnProgressComponent,
    BrnProgressIndicatorComponent,
    HlmProgressIndicatorDirective,
  ],
  providers: [
    provideIcons({
      lucideCircleStop,
      lucideCirclePause,
      lucideCirclePlay,
      lucideCircleX,
    }),
  ],
})
export class AudioRecorderComponent implements OnInit, OnDestroy {
  recordingDone = output<RecordingResult>();
  recordingDeleted = output<void>();
  isMicAllowed = output<boolean>();

  @ViewChild('record') record!: ElementRef<HTMLDivElement>;

  private readonly TIME_LIMIT = 60; // seconds
  private timerId: any;
  private audioContext: AudioContext;

  mediaRecorder?: MediaRecorder;
  private recordingTime = signal<number>(0);
  recordingPercentage = linkedSignal<number>(() =>
    Math.min((this.recordingTime() / this.TIME_LIMIT) * 100, 100)
  );
  audioUrl = signal<string>('');

  constructor() {
    // Initialize AudioContext once.
    this.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
  }

  async ngOnInit() {
    await this.startRecording();
  }

  async startRecording() {
    if (this.mediaRecorder) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.isMicAllowed.emit(true);
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

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

      this.mediaRecorder.ondataavailable = (e) => {
        chunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        clearInterval(this.timerId); // Stop visual timer
        this.recordingPercentage.set(100);

        const blob = new Blob(chunks, { type: 'audio/webm' });
        this.audioUrl.set(URL.createObjectURL(blob));

        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await this.audioContext.decodeAudioData(
            arrayBuffer
          );
          const accurateDuration = audioBuffer.duration;

          this.recordingDone.emit({ blob, duration: accurateDuration });
        } catch (error) {
          console.error('Failed to decode audio and get duration:', error);
          this.recordingDone.emit({ blob, duration: 0 });
        }

        stream.getTracks().forEach((track) => track.stop());
      };

      this.mediaRecorder.start();
    } catch (error) {
      this.isMicAllowed.emit(false);
      console.log('Error getting user media:', error);
    }
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
    this.recordingDeleted.emit();
  }

  ngOnDestroy(): void {
    if (this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.deleteRecording();
  }
}
