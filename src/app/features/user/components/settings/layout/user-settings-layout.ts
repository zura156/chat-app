import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { HlmSidebarImports, HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import { HlmCollapsibleImports } from '@spartan-ng/helm/collapsible';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmButtonImports } from '@spartan-ng/helm/button';

@Component({
  selector: 'user-settings-layout',
  templateUrl: './user-settings-layout.html',
  imports: [
    RouterOutlet,
    HlmSidebarImports,
    HlmCollapsibleImports,
    HlmButtonImports,
    NgIcon,
    HlmIcon,
    RouterLink],
  providers: [provideIcons({ lucideChevronRight })],
})
export class UserSettingsLayout {
  protected sidebarService = inject(HlmSidebarService);
  protected readonly _items = [
    {
      title: 'Personal',
      defaultOpen: true,
      items: [
        { title: 'Profile', route: 'profile' },
        { title: 'Account', route: 'account' }],
    },
    {
      title: 'Preferences',
      defaultOpen: true,
      items: [
        { title: 'Appearance', route: 'appearance' },
        { title: 'Notifications', route: 'notifications' }],
    },
    {
      title: 'Privacy & Security',
      defaultOpen: true,
      items: [
        { title: 'Privacy', route: 'privacy' },
        { title: 'Security', route: 'security' }],
    },
    {
      title: 'Data & Support',
      defaultOpen: true,
      items: [
        { title: 'Data & Storage', route: 'data-storage' },
        { title: 'Help & Support', route: 'help-support' }],
    }];
  isOpen = computed(this.sidebarService.open || this.sidebarService.openMobile);
}
