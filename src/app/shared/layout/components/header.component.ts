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

  themeMode$ = this.themeService.themeMode$;

  switchTheme(): void {
    this.themeService.switchTheme();
  }

  logOut(): void {
    this.authService.logOut().subscribe();
  }
}
