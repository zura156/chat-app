import { Component, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideShieldOff } from '@ng-icons/lucide';
import { HlmButton, HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { UserI } from '../../../interfaces/user.interface';
import { UserService } from '../../../services/user.service';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';

type Visibility = 'everyone' | 'contacts' | 'nobody';

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
export class PrivacySettings {
  private userService = inject(UserService);

  blockedUsers = signal<UserI[]>(
    (this.userService.currentUser()?.blocked_users as UserI[]) ?? [],
  );

  privacyItems = signal([
    {
      key: 'last_seen',
      label: 'Last seen',
      description: 'Who can see when you were last active',
      value: signal<Visibility>('everyone'),
    },
    {
      key: 'pfp_url',
      label: 'Profile picture',
      description: 'Who can see your profile photo',
      value: signal<Visibility>('everyone'),
    },
    {
      key: 'bio',
      label: 'Bio',
      description: 'Who can see your bio',
      value: signal<Visibility>('everyone'),
    },
    {
      key: 'online_status',
      label: 'Online status',
      description: "Who can see when you're online",
      value: signal<Visibility>('everyone'),
    },
  ]);

  unblock(user: UserI) {
    console.log('Yeah right.');
    // TODO
    // this.userService.unblockUser(user._id).subscribe({
    //   next: () => {
    //     this.blockedUsers.update((list) =>
    //       list.filter((u) => u._id !== user._id),
    //     );
    //   },
    // });
  }
}
