import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleCheck,
  lucideMail,
  lucideShieldCheck,
  lucideTrash2,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { UserService } from '../../../services/user.service';
import { AuthService } from '../../../../auth/services/auth.service';
import { toast } from '@spartan-ng/brain/sonner';

/**
 * This screen was titled "Account (MOCK COMPONENT)" and mostly was one: a
 * "Change" button beside the email that did nothing, a "Change password" button
 * that linked to a route the unauthenticated guard bounced signed-in users off,
 * and a hardcoded "This device / Active now" session list with a sign-out-all
 * button wired to nothing.
 *
 * Credentials and devices now live on the Security screen, which already owned
 * two-factor and the real session list — duplicating them here would have meant
 * two views of the same state drifting apart. What is left is what genuinely
 * belongs to the account rather than to a session: the address it is reachable
 * and recoverable through, and deleting it.
 */
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
      lucideMail,
      lucideCircleCheck,
      lucideTriangleAlert,
      lucideShieldCheck,
      lucideTrash2,
    }),
  ],
})
export class AccountSettings {
  private userService = inject(UserService);
  private authService = inject(AuthService);

  /**
   * The signal itself, not a snapshot.
   *
   * This was `currentUser()` — read once, during construction. On a cold load
   * the profile request has not resolved yet, so it captured `null` and the
   * whole template (`@if (user)`) rendered nothing, permanently, until a
   * navigation happened to rebuild the component.
   */
  readonly user = this.userService.currentUser;

  readonly pendingEmail = computed(() => this.user()?.pending_email ?? null);

  // ── Email ───────────────────────────────────────────────────────────────────

  readonly changingEmail = signal(false);
  readonly newEmail = signal('');
  readonly emailPassword = signal('');
  readonly savingEmail = signal(false);
  readonly resendingVerification = signal(false);

  beginEmailChange(): void {
    this.changingEmail.set(true);
    this.newEmail.set('');
    this.emailPassword.set('');
  }

  cancelEmailChange(): void {
    this.changingEmail.set(false);
    this.newEmail.set('');
    this.emailPassword.set('');
  }

  submitEmailChange(): void {
    const email = this.newEmail().trim();
    const password = this.emailPassword();

    if (!email || !password) {
      toast.error('Enter the new address and your password.');
      return;
    }

    this.savingEmail.set(true);
    this.authService.changeEmail(email, password).subscribe({
      next: (res) => {
        this.savingEmail.set(false);
        this.changingEmail.set(false);
        this.newEmail.set('');
        this.emailPassword.set('');
        toast.success(res?.message ?? `Check ${email} for a confirmation link.`);
      },
      error: (err) => {
        this.savingEmail.set(false);
        toast.error(
          typeof err === 'string'
            ? err
            : (err?.error?.message ?? 'Could not change your email address'),
        );
      },
    });
  }

  abandonPendingChange(): void {
    this.savingEmail.set(true);
    this.authService.cancelEmailChange().subscribe({
      next: () => {
        this.savingEmail.set(false);
        toast.success('Email change cancelled.');
      },
      error: () => {
        this.savingEmail.set(false);
        toast.error('Could not cancel the change');
      },
    });
  }

  resendVerification(): void {
    this.resendingVerification.set(true);
    this.authService.resendVerificationEmail().subscribe({
      next: () => {
        this.resendingVerification.set(false);
        toast.success('Verification email sent.');
      },
      error: (err) => {
        this.resendingVerification.set(false);
        toast.error(
          typeof err === 'string'
            ? err
            : (err?.error?.message ?? 'Could not send the email'),
        );
      },
    });
  }

  // ── Deletion ────────────────────────────────────────────────────────────────

  /*
   * The Delete account button had no click handler at all — it rendered, it
   * looked destructive, and it did nothing. This is the flow behind it.
   */
  readonly confirmingDelete = signal(false);
  readonly password = signal('');
  readonly deleting = signal(false);

  beginDelete(): void {
    this.confirmingDelete.set(true);
    this.password.set('');
  }

  cancelDelete(): void {
    this.confirmingDelete.set(false);
    this.password.set('');
  }

  confirmDelete(): void {
    const password = this.password().trim();
    if (!password) return;

    this.deleting.set(true);
    this.userService.deleteAccount(password).subscribe({
      next: () => {
        this.deleting.set(false);
        toast.success('Your account has been deleted');
        // The server has already cleared the auth cookies; this clears the
        // client state that mirrors them.
        this.authService.handleAuthFailure();
      },
      error: (err) => {
        this.deleting.set(false);
        toast.error(err?.error?.message ?? 'Could not delete your account');
      },
    });
  }
}
