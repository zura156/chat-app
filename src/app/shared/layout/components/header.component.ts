import { Component, inject } from '@angular/core';
import { ThemeService } from '../../services/theme.service';
import { AsyncPipe, NgIf } from '@angular/common';

@Component({
  selector: 'app-header',
  imports: [NgIf, AsyncPipe],
  templateUrl: './header.component.html',
})
export class HeaderComponent {
  themeService = inject(ThemeService);

  darkMode$ = this.themeService.darkMode$;

  toggleDarkMode(): void {
    this.themeService.toggleDarkMode();
  }
}
