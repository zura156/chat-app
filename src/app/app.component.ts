import { Component, inject } from '@angular/core';
import { HlmToasterImports } from '@spartan-ng/helm/sonner';
import { ThemeService } from './shared/services/theme.service';
import { RouterOutlet } from '@angular/router';
import { NgxLoadingBar } from '@ngx-loading-bar/core';

@Component({
  selector: 'app-root',
  imports: [HlmToasterImports, NgxLoadingBar, RouterOutlet],
  templateUrl: './app.component.html',
})
export class AppComponent {
  private themeService = inject(ThemeService);

  theme = this.themeService.theme;
}
