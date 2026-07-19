import { Component, inject, OnInit } from '@angular/core';
import { HlmToasterImports } from '@spartan-ng/helm/sonner';
import { ThemeService } from './shared/services/theme.service';
import { RouterOutlet } from '@angular/router';
import { NgxLoadingBar } from '@ngx-loading-bar/core';
// import { NotificationService } from './features/messages/services/notification.service';
import { AuthService } from './features/auth/services/auth.service';
import { ErudaService } from './shared/services/eruda.service';

@Component({
  selector: 'app-root',
  imports: [HlmToasterImports, NgxLoadingBar, RouterOutlet],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private themeService = inject(ThemeService);
  // private notificationService = inject(NotificationService);
  private authService = inject(AuthService);
  private eruda = inject(ErudaService);

  theme = this.themeService.theme;

  ngOnInit(): void {
    this.eruda.init(); // for development

    if (this.authService.isAuthenticated()) {
      // this.notificationService.loadNotifications();

      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }
}
