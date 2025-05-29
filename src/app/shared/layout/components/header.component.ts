import { Component, inject } from '@angular/core';
import { ThemeService } from '../../services/theme.service';
import { AsyncPipe } from '@angular/common';
import { AuthService } from '../../../features/auth/services/auth.service';

@Component({
  selector: 'app-header',
  imports: [AsyncPipe],
  templateUrl: './header.component.html',
})
export class HeaderComponent {
  themeService = inject(ThemeService);
  authService = inject(AuthService);

  darkMode$ = this.themeService.darkMode$;

  toggleDarkMode(): void {
    this.themeService.toggleDarkMode();
  }

  logOut(): void {
    this.authService.logOut();
    window.location.reload();
  }
}
