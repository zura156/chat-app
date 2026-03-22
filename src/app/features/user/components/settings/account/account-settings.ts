import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideLockKeyhole,
  lucideLogOut,
  lucideMonitor,
  lucideTrash2,
} from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { UserService } from '../../../services/user.service';

@Component({
  selector: 'user-account-settings',
  templateUrl: './account-settings.html',
  imports: [
    NgIcon,
    HlmIconImports,
    HlmButtonImports,
    HlmSeparatorImports,
    RouterLink,
  ],
  providers: [
    provideIcons({
      lucideLockKeyhole,
      lucideMonitor,
      lucideLogOut,
      lucideTrash2,
    }),
  ],
})
export class AccountSettings {
  private userService = inject(UserService);

  user = this.userService.currentUser();
}
