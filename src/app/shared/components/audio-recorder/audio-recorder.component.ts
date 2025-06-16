import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';

@Component({
  selector: 'app-audio-recorder',
  templateUrl: './audio-recorder.component.html',
  imports: [HlmButtonDirective],
})
export class AudioRecorderComponent implements OnDestroy {
  @ViewChild('record') record!: ElementRef<HTMLDivElement>;

  private mediaRecorder?: MediaRecorder;

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      this.mediaRecorder = new MediaRecorder(stream);

      // setInterval(() => {
      //   if (this.mediaRecorder?.state === 'recording') {
      //     console.log('helo');
      //   } else return;
      // }, 1000);

      this.mediaRecorder.ondataavailable = (e) => {
        console.log(e);

      };

      this.mediaRecorder.onstop = (e) => {
        this.displayRecording(e);
        stream.getTracks().forEach((track) => track.stop());
      };

      this.mediaRecorder.start(1000);
    } catch (error) {
      console.log('getUserMedia not supported on your browser!', error);
    }
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder?.stop();
      this.mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
    }
  }

  displayRecording(event: Event): void {
    console.log(event);
  }

  deleteRecording(): void {
    this.mediaRecorder = undefined;
  }

  ngOnDestroy(): void {}
}
