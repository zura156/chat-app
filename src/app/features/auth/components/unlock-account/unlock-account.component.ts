import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import {
  lucideLoader,
  lucideTriangleAlert,
  lucideCircleCheck,
  lucideLockOpen,
} from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { AuthService } from '../../services/auth.service';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { apiErrorMessage } from '../../../../shared/functions/api-error';

@Component({
  selector: 'app-unlock-account',
  templateUrl: './unlock-account.component.html',
  imports: [
    RouterLink,
    HlmButtonImports,
    HlmAlertImports,
    NgIconComponent,
    HlmIconImports,
  ],
  providers: [
    provideIcons({
      lucideLoader,
      lucideTriangleAlert,
      lucideCircleCheck,
      lucideLockOpen,
    }),
  ],
})
export class UnlockAccountComponent implements OnInit {
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);

  isLoading = signal(false);
  error = signal<string | null>(null);
  success = signal(false);

  ngOnInit(): void {
    // The lock email links here as /auth/unlock-account?token=…&id=…
    const { token, id } = this.route.snapshot.queryParams;

    if (!token || !id) {
      this.error.set(
        'This page needs the unlock link from your email. Open the link directly.',
      );
      return;
    }

    this.isLoading.set(true);
    this.authService.unlockAccount({ token, userId: id }).subscribe({
      next: () => {
        this.success.set(true);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set(
          apiErrorMessage(err, 'This link is invalid or has expired.'),
        );
        this.isLoading.set(false);
      },
    });
  }

  clearError() {
    this.error.set(null);
  }
}
