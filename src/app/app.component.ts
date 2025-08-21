import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HeaderComponent } from './shared/layout/components/header.component';
import { HlmToaster } from '@spartan-ng/helm/sonner';
import { ThemeService } from './shared/services/theme.service';
import { AsyncPipe } from '@angular/common';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';

@Component({
  selector: 'app-root',
  imports: [AsyncPipe, HlmToaster, HeaderComponent, IonRouterOutlet, IonApp],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private themeService = inject(ThemeService);

  theme$ = this.themeService.themeMode$;
}
