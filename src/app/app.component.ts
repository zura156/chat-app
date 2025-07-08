import { Component, inject } from '@angular/core';
import { HeaderComponent } from './shared/layout/components/header.component';
import { HlmToasterComponent } from '@spartan-ng/helm/sonner';
import { ThemeService } from './shared/services/theme.service';
import { AsyncPipe } from '@angular/common';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [
    AsyncPipe,
    HlmToasterComponent,
    HeaderComponent,
    IonRouterOutlet,
    RouterOutlet,
    IonApp,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent {
  private themeService = inject(ThemeService);

  theme$ = this.themeService.themeMode$;
}
