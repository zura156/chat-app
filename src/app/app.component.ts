import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/layout/components/header.component';
import { HlmToasterComponent } from '@spartan-ng/ui-sonner-helm';
import { ThemeService } from './shared/services/theme.service';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent, HlmToasterComponent, AsyncPipe],
  templateUrl: './app.component.html',
})
export class AppComponent {
  private themeService = inject(ThemeService);

  theme$ = this.themeService.themeMode$;
}
