import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import {
  lucideLoader,
  lucideTriangleAlert,
  lucideCircleCheck,
  lucideMail,
} from '@ng-icons/lucide';
import { AuthService } from '../../services/auth.service';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmIconImports } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-verify-email',
  templateUrl: './verify-email.component.html',
  imports: [
    RouterLink,
    HlmButton,
    HlmAlertImports,
    NgIconComponent,
    HlmIconImports,
  ],
  providers: [
    provideIcons({
      lucideLoader,
      lucideTriangleAlert,
      lucideCircleCheck,
      lucideMail,
    }),
  ],
})
export class VerifyEmailComponent {
  private authService = inject(AuthService);

  isLoading = signal(false);
  error = signal<string | null>(null);
  success = signal(false);

  clearError() {
    this.error.set(null);
  }

  resendVerification() {
    this.isLoading.set(true);
    this.error.set(null);
    this.success.set(false);

    // this.authService.resendVerificationEmail().subscribe({
    //   next: () => {
    //     this.success.set(true);
    //     this.isLoading.set(false);
    //   },
    //   error: (err) => {
    //     this.error.set(err?.error?.message ?? 'Something went wrong.');
    //     this.isLoading.set(false);
    //   },
    // });
  }
}
