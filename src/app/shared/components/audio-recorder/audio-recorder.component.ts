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
export class AudioRecorderComponent implements OnDestroy {
  recordingDeleted = output<void>();
  recordingDone = output<Blob>();

  @ViewChild('record') record!: ElementRef<HTMLDivElement>;

  private readonly TIME_LIMIT = 60; // seconds

  private timerId: any;

  mediaRecorder?: MediaRecorder;
  private recordingTime = signal<number>(0);
  recordingPercentage = linkedSignal<number>(() =>
    Math.min((this.recordingTime() / this.TIME_LIMIT) * 100, 100)
  );
  audioUrl = signal<string>('');

  async ngOnInit() {
    this.startRecording();
  }

  async startRecording() {
    if (this.mediaRecorder) {
      return;
    }

    try {
      let recordingStartTime = Date.now();
      let chunks: Blob[] = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      this.mediaRecorder = new MediaRecorder(stream);

      this.timerId = setInterval(() => {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        this.recordingTime.set(elapsed);

        if (elapsed >= this.TIME_LIMIT) {
          this.stopRecording();
        }
      }, 100);

      this.mediaRecorder.ondataavailable = (e) => {
        chunks.push(e.data);
        this.recordingTime.set((Date.now() - recordingStartTime) / 1000);

        if (this.recordingTime() > this.TIME_LIMIT) this.stopRecording();
      };

      this.mediaRecorder.onstop = (e) => {
        clearInterval(this.timerId); // stop timer
        this.recordingPercentage.set(100);

        const blob = new Blob(chunks, { type: 'audio/webm' });
        this.audioUrl.set(URL.createObjectURL(blob));
        this.recordingDone.emit(blob);

        stream.getTracks().forEach((track) => track.stop());
      };

      this.mediaRecorder.start(1000);
    } catch (error) {
      console.log('getUserMedia not supported on your browser!', error);
    }
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      clearInterval(this.timerId);
      this.mediaRecorder?.stop();
    }
  }

  deleteRecording(): void {
    this.stopRecording();
    this.mediaRecorder = undefined;
    this.recordingDeleted.emit();
  }

  ngOnDestroy(): void {
    this.deleteRecording();
  }
}
