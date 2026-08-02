import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { HlmSidebarImports, HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideBell,
  lucideChevronRight,
  lucideDatabase,
  lucideEye,
  lucideHelpCircle,
  lucideLogOut,
  lucidePalette,
  lucideSettings,
  lucideShield,
  lucideUser2,
} from '@ng-icons/lucide';
import { HlmCollapsibleImports } from '@spartan-ng/helm/collapsible';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { UserService } from '../../../services/user.service';
import { filter, startWith, map } from 'rxjs';
import { AuthService } from '../../../../auth/services/auth.service';

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
    HlmSeparatorImports,
    HlmAvatarImports,
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
      lucideArrowLeft,
      lucideLogOut,
    }),
  ],
})
export class UserSettingsLayout implements OnInit {
  protected sidebarService = inject(HlmSidebarService);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private userService = inject(UserService);
  private authService = inject(AuthService);

  user = this.userService.currentUser;

  activePageTitle = signal<string>('');
  protected readonly preferencesItems = [
    { title: 'Profile', url: 'profile', icon: 'lucideUser2' },
    { title: 'Account', url: 'account', icon: 'lucideSettings' },
    { title: 'Appearance', url: 'appearance', icon: 'lucidePalette' },
    { title: 'Notifications', url: 'notifications', icon: 'lucideBell' },
    { title: 'Privacy', url: 'privacy', icon: 'lucideEye' },
    { title: 'Security', url: 'security', icon: 'lucideShield' },
  ];

  protected readonly moreItems = [
    { title: 'Data & Storage', url: 'data-storage', icon: 'lucideDatabase' },
    { title: 'Help & Support', url: 'help-support', icon: 'lucideHelpCircle' },
  ];

  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        startWith(null),
        map(() => {
          let route = this.activatedRoute;
          while (route.firstChild) route = route.firstChild;
          return route?.snapshot?.title ?? '';
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((title) => this.activePageTitle.set(title));
  }

  logOut(): void {
    this.authService.logOut().subscribe();
  }
}
