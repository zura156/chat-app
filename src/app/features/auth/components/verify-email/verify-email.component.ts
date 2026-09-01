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

        /*
         * Re-read the profile so the verification wall actually lifts.
         *
         * `refreshCurrentUser` existed for exactly this and was called from one
         * place: the "I've verified" button on the wall itself. Following the
         * link — the path everyone actually takes — left `is_email_verified`
         * false in the cached user, so the wall was still there when they
         * navigated back, and the only ways out were that button or a reload.
         *
         * Guarded on the session: this link is routinely opened in a browser
         * with no cookies, and asking for the profile there would 401 and be
         * turned into a sign-out.
         */
        if (this.authService.isAuthenticated()) {
          this.authService
            .refreshCurrentUser()
            .subscribe({ error: () => undefined });
        }
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
