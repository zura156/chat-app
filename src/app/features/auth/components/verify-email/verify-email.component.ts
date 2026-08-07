import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
import { apiErrorMessage } from '../../../../shared/functions/api-error';

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
export class VerifyEmailComponent implements OnInit {
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);

  isLoading = signal(false);
  error = signal<string | null>(null);
  success = signal(false);
  /** true once the token from the email link has been accepted */
  verified = signal(false);

  ngOnInit(): void {
    // The email link lands here as /auth/verify-email?token=…&id=…
    const { token, id } = this.route.snapshot.queryParams;
    if (!token || !id) return;

    this.isLoading.set(true);
    this.authService.verifyEmail(token, id).subscribe({
      next: () => {
        this.verified.set(true);
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
