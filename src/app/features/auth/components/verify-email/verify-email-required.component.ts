import { Component, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMailWarning, lucideRefreshCw } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { toast } from '@spartan-ng/brain/sonner';
import { AuthService } from '../../services/auth.service';

/**
 * Shown when the account is signed in but its address is unverified and
 * verification is enforced.
 *
 * Without this the gate was a dead end: the API refused every request, the
 * interceptor raised a toast, and the user was left looking at an empty chat
 * list with no explanation and nothing to click.
 */
@Component({
  selector: 'app-verify-email-required',
  imports: [NgIcon, HlmIcon, HlmButton],
  providers: [provideIcons({ lucideMailWarning, lucideRefreshCw })],
  template: `
    <div
      class="flex flex-1 flex-col items-center justify-center gap-y-4 p-8 text-center"
    >
      <ng-icon
        hlm
        name="lucideMailWarning"
        size="xl"
        class="text-muted-foreground"
      />

      <div class="space-y-1">
        <h2 class="text-base font-medium">Verify your email address</h2>
        <p class="max-w-sm text-sm text-muted-foreground">
          We sent a link to
          <span class="font-medium text-foreground">{{ email() }}</span
          >. Click it to start using your account. The link expires after an
          hour.
        </p>
      </div>

      <div class="flex items-center gap-x-2">
        <button
          hlmBtn
          size="sm"
          class="cursor-pointer rounded-full text-xs"
          [disabled]="sending()"
          (click)="resend()"
        >
          {{ sending() ? 'Sending…' : 'Resend link' }}
        </button>
        <button
          hlmBtn
          variant="outline"
          size="sm"
          class="cursor-pointer rounded-full text-xs"
          [disabled]="checking()"
          (click)="recheck()"
        >
          <ng-icon hlm name="lucideRefreshCw" size="xs" class="mr-1.5" />
          I've verified
        </button>
      </div>
    </div>
  `,
})
export class VerifyEmailRequiredComponent {
  private readonly auth = inject(AuthService);

  readonly sending = signal(false);
  readonly checking = signal(false);

  readonly email = () => this.auth.user()?.email ?? 'your address';

  resend(): void {
    this.sending.set(true);
    this.auth.resendVerificationEmail().subscribe({
      next: () => {
        this.sending.set(false);
        toast.success('Verification email sent.');
      },
      error: (message) => {
        this.sending.set(false);
        toast.error(
          typeof message === 'string' ? message : 'Could not send the email.',
        );
      },
    });
  }

  /** Verification happens in a mail client, so the app has to be told to look again. */
  recheck(): void {
    this.checking.set(true);
    this.auth.refreshCurrentUser().subscribe({
      next: (user) => {
        this.checking.set(false);
        if (!user.is_email_verified) {
          toast.warning('Still unverified — check the link in your inbox.');
        }
      },
      error: () => this.checking.set(false),
    });
  }
}
