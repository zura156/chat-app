import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideShieldCheck,
  lucideShieldOff,
  lucideMonitor,
  lucideSmartphone,
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
  readonly setupStage = signal<'idle' | 'scanning' | 'recovery'>('idle');
  readonly setupSecret = signal<string | null>(null);
  readonly setupUri = signal<string | null>(null);
  readonly recoveryCodes = signal<string[]>([]);
  readonly code = signal('');
  readonly busy = signal(false);
  readonly disarming = signal(false);

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

  startTwoFactorSetup(): void {
    this.busy.set(true);
    this.security.beginTwoFactorSetup().subscribe({
      next: (setup) => {
        this.setupSecret.set(setup.secret);
        this.setupUri.set(setup.otpauth_uri);
        this.setupStage.set('scanning');
        this.code.set('');
        this.busy.set(false);
      },
      error: () => {
        this.busy.set(false);
        toast.error('Could not start two-factor setup');
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
  }

  beginDisable(): void {
    this.disarming.set(true);
    this.code.set('');
  }

  cancelDisable(): void {
    this.disarming.set(false);
    this.code.set('');
  }

  confirmDisable(): void {
    const code = this.code().trim();
    if (!code) return;

    this.busy.set(true);
    this.security.disableTwoFactor(code).subscribe({
      next: () => {
        this.busy.set(false);
        this.disarming.set(false);
        this.code.set('');
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
