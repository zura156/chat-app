import { Component, inject } from '@angular/core';
import { NotificationService } from '../../../features/messages/services/notification.service';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { lucideBell } from '@ng-icons/lucide';

@Component({
  selector: 'app-notification-bell',
  imports: [HlmButtonImports, NgIcon, HlmIconImports],
  providers: [provideIcons({ lucideBell })],
  template: `
    <button hlmBtn variant="ghost" class="relative">
      <ng-icon name="lucideBell" />
      @if (totalUnread() > 0) {
        <span
          class="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center"
        >
          {{ totalUnread() > 99 ? '99+' : totalUnread() }}
        </span>
      }
    </button>
  `,
})
export class NotificationBell {
  private notificationService = inject(NotificationService);

  totalUnread = this.notificationService.totalUnread;
}
