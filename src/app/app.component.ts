import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/layout/components/header.component';
import { AudioRecorderComponent } from "./shared/components/audio-recorder/audio-recorder.component";

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent, AudioRecorderComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {}
