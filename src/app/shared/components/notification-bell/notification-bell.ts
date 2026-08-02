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
    <button
      hlmBtn
      variant="ghost"
      class="relative cursor-pointer rounded-full size-9 p-0 flex items-center justify-center hover:bg-muted transition-colors"
      [attr.aria-label]="
        totalUnread() > 0
          ? totalUnread() + ' unread messages'
          : 'No unread messages'
      "
    >
      <ng-icon hlm size="sm" name="lucideBell" />
      @if (totalUnread() > 0) {
        <span
          class="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] leading-none font-medium rounded-full min-w-4 h-4 px-1 flex items-center justify-center"
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
