import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
export interface AudioMessage {
  blob: Blob;
  duration: number;
  timestamp: Date;
  size: number;
}
@Component({
  selector: 'app-audio-recorder',
  templateUrl: './audio-recorder.component.html',
  imports: [NgIf, NgFor, NgClass],
})
export class AudioRecorderComponent implements OnDestroy {
   @ViewChild('audioPlayer') audioPlayer!: ElementRef<HTMLAudioElement>;
  
  // Events for parent component
  @Output() audioSent = new EventEmitter<AudioMessage>();
  @Output() recordingStarted = new EventEmitter<void>();
  @Output() recordingStopped = new EventEmitter<void>();
  @Output() recordingCanceled = new EventEmitter<void>();
  
  // Configuration
  @Input() maxDuration = 60; // 5 minutes max
  @Input() minDuration = 1; // 1 second minimum
  @Input() autoSend = false; // Auto-send after recording

  // State
  isRecording = false;
  isPlaying = false;
  hasPermission = false;
  audioBlob: Blob | null = null;
  mediaRecorder: MediaRecorder | null = null;
  audioChunks: Blob[] = [];
  recordingTime = 0;
  playbackTime = 0;
  totalDuration = 0;
  errorMessage = '';
  audioLevels: number[] = new Array(12).fill(0).map(() => Math.random() * 20 + 5);
  
  private recordingInterval: any;
  private playbackInterval: any;
  private animationInterval: any;
  private maxDurationTimeout: any;

  constructor() {
    this.checkMicrophonePermission();
  }

  ngOnDestroy() {
    this.cleanup();
  }

  get progressPercentage(): number {
    if (this.totalDuration === 0) return 0;
    return (this.playbackTime / this.totalDuration) * 100;
  }

  async checkMicrophonePermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.hasPermission = true;
      stream.getTracks().forEach(track => track.stop());
      this.errorMessage = '';
    } catch (error) {
      this.hasPermission = false;
      this.errorMessage = 'Microphone access is required for audio messages';
    }
  }

  async startRecording() {
    if (!this.hasPermission) {
      await this.checkMicrophonePermission();
      if (!this.hasPermission) return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        }
      });

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: this.getSupportedMimeType()
      });

      this.audioChunks = [];
      this.recordingTime = 0;
      this.errorMessage = '';

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.audioBlob = new Blob(this.audioChunks, { type: this.getSupportedMimeType() });
        stream.getTracks().forEach(track => track.stop());
        this.recordingStopped.emit();
        
        if (this.autoSend && this.recordingTime >= this.minDuration) {
          setTimeout(() => this.sendAudio(), 500);
        }
      };

      this.mediaRecorder.start(100);
      this.isRecording = true;
      this.recordingStarted.emit();

      // Recording timer
      this.recordingInterval = setInterval(() => {
        this.recordingTime++;
        if (this.recordingTime >= this.maxDuration) {
          this.stopRecording();
        }
      }, 1000);

      // Waveform animation
      this.animationInterval = setInterval(() => {
        this.audioLevels = this.audioLevels.map(() => Math.random() * 20 + 5);
      }, 150);

    } catch (error) {
      console.error('Error starting recording:', error);
      this.errorMessage = 'Failed to start recording. Please check your microphone.';
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.clearIntervals();
      
      if (this.recordingTime < this.minDuration) {
        this.errorMessage = `Recording must be at least ${this.minDuration} second(s) long`;
        this.deleteRecording();
      }
    }
  }

  cancelRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.clearIntervals();
      this.audioBlob = null;
      this.audioChunks = [];
      this.recordingTime = 0;
      this.recordingCanceled.emit();
    }
  }

  togglePlayback() {
    if (this.isPlaying) {
      this.pausePlayback();
    } else {
      this.playRecording();
    }
  }

  playRecording() {
    if (this.audioBlob && this.audioPlayer) {
      const audioUrl = URL.createObjectURL(this.audioBlob);
      this.audioPlayer.nativeElement.src = audioUrl;
      this.audioPlayer.nativeElement.play();
      this.isPlaying = true;

      this.playbackInterval = setInterval(() => {
        this.playbackTime = Math.floor(this.audioPlayer.nativeElement.currentTime);
      }, 100);
    }
  }

  pausePlayback() {
    if (this.audioPlayer && this.isPlaying) {
      this.audioPlayer.nativeElement.pause();
      this.isPlaying = false;
      clearInterval(this.playbackInterval);
    }
  }

  sendAudio() {
    if (this.audioBlob) {
      const audioMessage: AudioMessage = {
        blob: this.audioBlob,
        duration: this.recordingTime,
        timestamp: new Date(),
        size: this.audioBlob.size
      };
      
      this.audioSent.emit(audioMessage);
      this.reset();
    }
  }

  deleteRecording() {
    this.reset();
  }

  onPlaybackEnded() {
    this.isPlaying = false;
    this.playbackTime = 0;
    clearInterval(this.playbackInterval);
  }

  onTimeUpdate(event: any) {
    this.playbackTime = event.target.currentTime;
  }

  onMetadataLoaded(event: any) {
    this.totalDuration = Math.floor(event.target.duration);
  }

  clearError() {
    this.errorMessage = '';
  }

  private reset() {
    this.audioBlob = null;
    this.audioChunks = [];
    this.recordingTime = 0;
    this.playbackTime = 0;
    this.totalDuration = 0;
    this.isPlaying = false;
    this.errorMessage = '';
    
    if (this.audioPlayer) {
      this.audioPlayer.nativeElement.src = '';
    }
  }

  private cleanup() {
    this.clearIntervals();
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    if (this.maxDurationTimeout) {
      clearTimeout(this.maxDurationTimeout);
    }
  }

  private clearIntervals() {
    if (this.recordingInterval) clearInterval(this.recordingInterval);
    if (this.playbackInterval) clearInterval(this.playbackInterval);
    if (this.animationInterval) clearInterval(this.animationInterval);
  }

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'audio/webm';
  }

  formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i];
  }
}
