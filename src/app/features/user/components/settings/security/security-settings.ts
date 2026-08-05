import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideShieldCheck,
  lucideShieldOff,
  lucideMonitor,
  lucideSmartphone,
  lucideKeyRound,
} from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { toast } from '@spartan-ng/brain/sonner';
import {
  SecuritySettingsService,
  SessionI,
} from '../../../services/security-settings.service';
import { AuthService } from '../../../../auth/services/auth.service';
import { encodeQr } from '../../../../../shared/utils/qr-code';

/**
 * This screen used to render a hardcoded login history — plausible cities,
 * computed relative dates, one entry flagged as the current session — with no
 * session tracking behind it. Someone checking whether anyone else was signed
 * into their account got a fabricated "no".
 *
 * Everything here now comes from live refresh-token sessions. Location is
 * deliberately absent: the server records the address a request arrived from,
 * and turning that into a city name would be the same invention with extra
 * steps.
 */
@Component({
  templateUrl: './security-settings.html',
  imports: [
    NgIcon,
    HlmIconImports,
    HlmSeparatorImports,
    HlmButtonImports,
    DatePipe,
  ],
  providers: [
    provideIcons({
      lucideShieldCheck,
      lucideShieldOff,
      lucideMonitor,
      lucideSmartphone,
      lucideKeyRound,
    }),
  ],
})
export class SecuritySettings implements OnInit {
  private readonly security = inject(SecuritySettingsService);
  private readonly authService = inject(AuthService);

  readonly sessions = this.security.sessions;
  readonly twoFactor = this.security.twoFactor;
  readonly loading = this.security.loading;

  readonly revoking = signal<ReadonlySet<string>>(new Set());

  /** Enrolment is a short wizard, so its stage lives here rather than a route. */
  /**
   * `confirming-password` was added because enrolment now costs the account
   * password, not just a live session.
   */
  readonly setupStage = signal<
    'idle' | 'confirming-password' | 'scanning' | 'recovery'
  >('idle');
  readonly setupSecret = signal<string | null>(null);
  readonly setupUri = signal<string | null>(null);
  readonly recoveryCodes = signal<string[]>([]);
  readonly code = signal('');

  /**
   * Re-entered to add or remove a second factor. Never persisted — held only
   * for the duration of the request and cleared on every exit path.
   */
  readonly password = signal('');
  readonly busy = signal(false);
  readonly disarming = signal(false);

  readonly currentUser = this.authService.user;

  // ── Password change ─────────────────────────────────────────────────────────

  readonly changingPassword = signal(false);
  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');

  /**
   * Why the form cannot be submitted yet, or null when it can.
   *
   * The rule mirrors the server's `passwordRule`. Duplicating a constraint is
   * usually a smell, but the alternative here is making the user submit — and
   * re-enter their current password — to be told the new one is too short.
   * The server remains the authority; this only saves a round trip.
   */
  readonly passwordProblem = computed<string | null>(() => {
    const current = this.currentPassword();
    const next = this.newPassword();
    const confirmation = this.confirmPassword();

    if (!current) return null;
    if (!next) return null;

    if (next.length < 8) return 'Use at least 8 characters.';
    if (next.length > 128) return 'Use at most 128 characters.';
    if (!/[a-z]/.test(next)) return 'Include a lowercase letter.';
    if (!/[A-Z]/.test(next)) return 'Include an uppercase letter.';
    if (!/\d/.test(next)) return 'Include a number.';
    if (!/[@$!%*?&]/.test(next)) return 'Include a symbol (@ $ ! % * ? &).';
    if (next === current) return 'Choose a password you have not used here.';
    if (confirmation && next !== confirmation) return 'The two do not match.';
    if (!confirmation) return null;

    return null;
  });

  beginPasswordChange(): void {
    this.changingPassword.set(true);
    this.clearPasswordFields();
  }

  cancelPasswordChange(): void {
    this.changingPassword.set(false);
    this.clearPasswordFields();
  }

  submitPasswordChange(): void {
    const current = this.currentPassword();
    const next = this.newPassword();
    const confirmation = this.confirmPassword();

    // `passwordProblem` returns null while fields are still empty so the form
    // does not shout at someone who has only started typing; submission is
    // where completeness actually has to be checked.
    if (!current || !next || !confirmation) {
      toast.error('Fill in all three fields.');
      return;
    }
    if (next !== confirmation) {
      toast.error('The two new passwords do not match.');
      return;
    }
    if (this.passwordProblem()) return;

    this.busy.set(true);
    this.security.changePassword(current, next).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.changingPassword.set(false);
        this.clearPasswordFields();

        const others = res?.signed_out_sessions ?? 0;
        toast.success(
          others > 0
            ? `Password changed. ${others} other ${
                others === 1 ? 'device was' : 'devices were'
              } signed out.`
            : 'Password changed.',
        );
      },
      error: (err) => {
        this.busy.set(false);
        toast.error(err?.error?.message ?? 'Could not change your password');
      },
    });
  }

  private clearPasswordFields(): void {
    this.currentPassword.set('');
    this.newPassword.set('');
    this.confirmPassword.set('');
  }

  /**
   * The enrolment URI as a scannable symbol. Without this the only path onto a
   * phone is hand-typing a 32-character secret, since the otpauth:// link only
   * resolves on a device that has the authenticator app installed — which is
   * rarely the device the settings page is open on.
   */
  readonly setupQr = computed(() => {
    const uri = this.setupUri();
    return uri ? encodeQr(uri) : null;
  });

  ngOnInit(): void {
    this.security.load().subscribe();
    this.security.loadTwoFactor().subscribe();
  }

  describeDevice(session: SessionI): string {
    return this.security.describeDevice(session.user_agent);
  }

  isMobile(session: SessionI): boolean {
    return this.security.isMobile(session.user_agent);
  }

  isRevoking(id: string): boolean {
    return this.revoking().has(id);
  }

  revoke(session: SessionI): void {
    if (this.isRevoking(session.id)) return;
    this.markRevoking(session.id, true);

    this.security.revokeSession(session.id).subscribe({
      next: () => {
        this.markRevoking(session.id, false);
        toast.success('Session signed out');
        // Revoking your own session ends this one too.
        if (session.current) this.authService.handleAuthFailure();
      },
      error: () => {
        this.markRevoking(session.id, false);
        toast.error('Could not sign that session out');
      },
    });
  }

  signOutAllDevices(): void {
    this.busy.set(true);
    this.security.revokeAllSessions().subscribe({
      next: () => {
        this.busy.set(false);
        this.authService.handleAuthFailure();
      },
      error: () => {
        this.busy.set(false);
        toast.error('Could not sign out everywhere');
      },
    });
  }

  /** Opens the password prompt that precedes enrolment. */
  beginSetup(): void {
    this.setupStage.set('confirming-password');
    this.password.set('');
    this.code.set('');
  }

  startTwoFactorSetup(): void {
    const password = this.password().trim();
    if (!password) return;

    this.busy.set(true);
    this.security.beginTwoFactorSetup(password).subscribe({
      next: (setup) => {
        this.setupSecret.set(setup.secret);
        this.setupUri.set(setup.otpauth_uri);
        this.setupStage.set('scanning');
        this.code.set('');
        this.password.set('');
        this.busy.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        toast.error(err?.error?.message ?? 'Could not start two-factor setup');
      },
    });
  }

  confirmTwoFactorSetup(): void {
    const code = this.code().trim();
    if (code.length !== 6) return;

    this.busy.set(true);
    this.security.confirmTwoFactorSetup(code).subscribe({
      next: (res) => {
        this.recoveryCodes.set(res.recovery_codes);
        this.setupStage.set('recovery');
        this.setupSecret.set(null);
        this.setupUri.set(null);
        this.code.set('');
        this.busy.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        toast.error(err?.error?.message ?? 'That code is not correct');
      },
    });
  }

  finishSetup(): void {
    this.setupStage.set('idle');
    this.recoveryCodes.set([]);
  }

  cancelSetup(): void {
    this.setupStage.set('idle');
    this.setupSecret.set(null);
    this.setupUri.set(null);
    this.code.set('');
    this.password.set('');
  }

  beginDisable(): void {
    this.disarming.set(true);
    this.code.set('');
    this.password.set('');
  }

  cancelDisable(): void {
    this.disarming.set(false);
    this.code.set('');
    this.password.set('');
  }

  confirmDisable(): void {
    const code = this.code().trim();
    const password = this.password().trim();
    if (!code || !password) return;

    this.busy.set(true);
    this.security.disableTwoFactor(code, password).subscribe({
      next: () => {
        this.busy.set(false);
        this.disarming.set(false);
        this.code.set('');
        this.password.set('');
        toast.success('Two-factor authentication turned off');
        // Disabling revokes every session, including this one.
        this.authService.handleAuthFailure();
      },
      error: (err) => {
        this.busy.set(false);
        toast.error(err?.error?.message ?? 'That code is not correct');
      },
    });
  }

  copyRecoveryCodes(): void {
    navigator.clipboard
      ?.writeText(this.recoveryCodes().join('\n'))
      .then(() => toast.success('Recovery codes copied'))
      .catch(() => toast.error('Could not copy'));
  }

  onCodeInput(value: string): void {
    this.code.set(value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 11));
  }

  private markRevoking(id: string, active: boolean): void {
    this.revoking.update((ids) => {
      const next = new Set(ids);
      active ? next.add(id) : next.delete(id);
      return next;
    });
  }
}
