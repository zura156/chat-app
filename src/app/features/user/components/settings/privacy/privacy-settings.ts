import { Component, OnInit, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideShieldOff } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { toast } from '@spartan-ng/brain/sonner';
import { UserI } from '../../../interfaces/user.interface';
import {
  PrivacySettingsI,
  PrivacySettingsService,
  Visibility,
} from '../../../services/privacy-settings.service';

/**
 * The visibility dropdowns here used to be a hardcoded signal array with no
 * server model behind them, and `unblock()` was `console.log('Yeah right.')`.
 * Both are real now.
 *
 * "Contacts" means people you share a conversation with — the only
 * relationship this app models, so it is the only honest reading of the word.
 */
@Component({
  templateUrl: './privacy-settings.html',
  imports: [
    NgIcon,
    HlmIconImports,
    HlmAvatarImports,
    HlmSeparatorImports,
    HlmButtonImports,
  ],
  providers: [provideIcons({ lucideShieldOff })],
})
export class PrivacySettings implements OnInit {
  private readonly settings = inject(PrivacySettingsService);

  readonly privacy = this.settings.privacy;
  readonly blockedUsers = this.settings.blockedUsers;
  readonly loading = this.settings.loading;

  readonly privacyItems: {
    key: keyof PrivacySettingsI;
    label: string;
    description: string;
  }[] = [
    {
      key: 'last_seen',
      label: 'Last seen',
      description: 'Who can see when you were last active',
    },
    {
      key: 'pfp_url',
      label: 'Profile picture',
      description: 'Who can see your profile photo',
    },
    {
      key: 'bio',
      label: 'Bio',
      description: 'Who can see your bio',
    },
    {
      key: 'online_status',
      label: 'Online status',
      description: "Who can see when you're online",
    },
  ];

  ngOnInit(): void {
    this.settings.load().subscribe();
  }

  valueOf(key: keyof PrivacySettingsI): Visibility {
    return this.privacy()[key];
  }

  isSaving(key: keyof PrivacySettingsI): boolean {
    return this.settings.isSaving(key);
  }

  setVisibility(key: keyof PrivacySettingsI, value: string): void {
    this.settings.setVisibility(key, value as Visibility).subscribe({
      error: () => toast.error('Could not save that setting'),
    });
  }

  unblock(user: UserI): void {
    this.settings.unblock(user).subscribe({
      next: () => toast.success(`Unblocked @${user.username}`),
      error: () => toast.error('Could not unblock that user'),
    });
  }
}
