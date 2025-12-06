import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HlmSidebarImports, HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBell,
  lucideChevronRight,
  lucideDatabase,
  lucideEye,
  lucideHelpCircle,
  lucidePalette,
  lucideSettings,
  lucideShield,
  lucideUser2,
} from '@ng-icons/lucide';
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
    RouterLink,
    RouterLinkActive,
  ],
  providers: [
    provideIcons({
      lucideChevronRight,
      lucideUser2,
      lucideSettings,
      lucidePalette,
      lucideBell,
      lucideEye,
      lucideShield,
      lucideDatabase,
      lucideHelpCircle,
    }),
  ],
})
export class UserSettingsLayout {
  protected sidebarService = inject(HlmSidebarService);
  protected readonly items = [
    { title: 'Profile', url: 'profile', icon: 'lucideUser2' },
    { title: 'Account', url: 'account', icon: 'lucideSettings' },
    { title: 'Appearance', url: 'appearance', icon: 'lucidePalette' },
    { title: 'Notifications', url: 'notifications', icon: 'lucideBell' },
    { title: 'Privacy', url: 'privacy', icon: 'lucideEye' },
    { title: 'Security', url: 'security', icon: 'lucideShield' },
    { title: 'Data & Storage', url: 'data-storage', icon: 'lucideDatabase' },
    { title: 'Help & Support', url: 'help-support', icon: 'lucideHelpCircle' },
  ];
  isOpen = computed(this.sidebarService.open || this.sidebarService.openMobile);
}
