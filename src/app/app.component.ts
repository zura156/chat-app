import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HeaderComponent } from './shared/layout/components/header.component';
import { HlmToasterImports } from '@spartan-ng/helm/sonner';
import { ThemeService } from './shared/services/theme.service';
import { AsyncPipe } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { NgxLoadingBar } from '@ngx-loading-bar/core';

@Component({
  selector: 'app-root',
  imports: [
    AsyncPipe,
    HlmToasterImports,
    NgxLoadingBar,
    HeaderComponent,
    RouterOutlet,
  ],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private themeService = inject(ThemeService);

  theme$ = this.themeService.themeMode$;
}
