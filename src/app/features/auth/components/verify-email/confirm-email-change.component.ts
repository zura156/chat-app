import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideLoader,
  lucideCircleCheck,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { AuthService } from '../../services/auth.service';
import { apiErrorMessage } from '../../../../shared/functions/api-error';

/**
 * Lands from the confirmation link sent to a *new* address.
 *
 * Deliberately usable without a session: the mail client hands the link to
 * whichever browser is default, which is routinely not the one that requested
 * the change. Confirming signs every device out, so this always ends at the
 * login screen rather than back in the app.
 */
@Component({
  selector: 'app-confirm-email-change',
  imports: [RouterLink, NgIcon, HlmIcon, HlmButton],
  providers: [
    provideIcons({ lucideLoader, lucideCircleCheck, lucideTriangleAlert }),
  ],
  template: `
    <main
      class="flex min-h-dvh flex-col items-center justify-center gap-y-4 p-8 text-center"
    >
      @if (loading()) {
        <ng-icon
          hlm
          name="lucideLoader"
          size="lg"
          class="animate-spin text-muted-foreground"
        />
        <p class="text-sm text-muted-foreground">Confirming your address…</p>
      } @else if (confirmed()) {
        <ng-icon
          hlm
          name="lucideCircleCheck"
          size="xl"
          class="text-green-600"
        />
        <div class="space-y-1">
          <h1 class="text-base font-medium">Email address updated</h1>
          <p class="max-w-sm text-sm text-muted-foreground">
            Sign in again with your new address. For your security, every device
            was signed out.
          </p>
        </div>
        <a
          hlmBtn
          size="sm"
          class="cursor-pointer rounded-full text-xs"
          routerLink="/auth/login"
        >
          Go to sign in
        </a>
      } @else {
        <ng-icon
          hlm
          name="lucideTriangleAlert"
          size="xl"
          class="text-destructive"
        />
        <div class="space-y-1">
          <h1 class="text-base font-medium">That link didn't work</h1>
          <p class="max-w-sm text-sm text-muted-foreground">{{ error() }}</p>
        </div>
        <a
          hlmBtn
          variant="outline"
          size="sm"
          class="cursor-pointer rounded-full text-xs"
          routerLink="/auth/login"
        >
          Back to sign in
        </a>
      }
    </main>
  `,
})
export class ConfirmEmailChangeComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly confirmed = signal(false);
  readonly error = signal('This link is invalid or has expired.');

  ngOnInit(): void {
    const { token, id } = this.route.snapshot.queryParams;
    if (!token || !id) {
      this.error.set('This link is missing information.');
      return;
    }

    this.loading.set(true);
    this.auth.confirmEmailChange(token, id).subscribe({
      next: () => {
        this.loading.set(false);
        this.confirmed.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          apiErrorMessage(err, 'This link is invalid or has expired.'),
        );
      },
    });
  }
}
