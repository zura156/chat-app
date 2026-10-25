import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoader } from '@ng-icons/lucide';
import { AuthService } from '../../services/auth.service';

/**
 * Where the server sends the browser after a provider sign-in succeeds.
 *
 * It exists because the session arrives as httpOnly cookies the SPA cannot
 * read: landing on `/` instead left the app's own signed-in flag false, so the
 * guard bounced a freshly signed-in user straight to the login form. Loading
 * the user here proves the cookies work before anything claims a session.
 *
 * Unguarded on purpose — the unauthenticated guard reads that same stale flag.
 */
@Component({
  selector: 'app-oidc-callback',
  imports: [NgIcon],
  providers: [provideIcons({ lucideLoader })],
  template: `
    <div
      class="flex min-h-dvh flex-col items-center justify-center gap-3 px-6"
      role="status"
      aria-live="polite"
    >
      <ng-icon
        name="lucideLoader"
        class="animate-spin text-2xl text-muted-foreground"
        aria-hidden="true"
      />
      <p class="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  `,
})
export class OidcCallbackComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  constructor() {
    // Success navigates from inside completeLogin, honouring the parked
    // returnUrl; only the failure is handled here.
    this.authService
      .completeOidcLogin()
      .pipe(takeUntilDestroyed())
      .subscribe({
        error: () =>
          this.router.navigate(['/auth/login'], {
            queryParams: { error: 'oidc_failed' },
          }),
      });
  }
}
