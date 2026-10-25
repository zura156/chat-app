import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideShieldCheck,
  lucideShieldOff,
  lucideMonitor,
  lucideSmartphone,
  lucideKeyRound,
  lucideMail,
} from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { toast } from '@spartan-ng/brain/sonner';
import {
  SecuritySettingsService,
  SessionI,
  TwoFactorMethod,
} from '../../../services/security-settings.service';
import {
  AuthService,
  OidcProvider,
} from '../../../../auth/services/auth.service';
import {
  OIDC_PROVIDER_DETAILS,
  injectEnabledOidcProviders,
  isOidcProvider,
} from '../../../../auth/services/oidc-providers';
import { encodeQr } from '../../../../../shared/utils/qr-code';
import { describePasswordProblems } from '../../../../auth/validators/password.validator';
import { apiErrorMessage } from '../../../../../shared/functions/api-error';
import { ActivatedRoute, Router } from '@angular/router';
import { remixGithubFill, remixGoogleFill } from '@ng-icons/remixicon';

/** What a connect that came back unsuccessful means, from its `?link_error=`. */
const LINK_ERROR_MESSAGES: Record<string, string> = {
  oidc_cancelled: 'Connecting was cancelled.',
  oidc_expired:
    'That took too long, or your session changed on the way. Please try again.',
  oidc_failed: 'Could not connect that account. Please try again.',
  oidc_unavailable: 'That sign-in option is not available right now.',
  identity_in_use:
    'That account is already connected to a different account here.',
  provider_in_use:
    'A different account from that provider is already connected. Disconnect it first.',
};

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
      lucideMail,
      remixGithubFill,
      remixGoogleFill,
    }),
  ],
})
export class SecuritySettings implements OnInit {
  private readonly security = inject(SecuritySettingsService);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly sessions = this.security.sessions;
  readonly twoFactor = this.security.twoFactor;
  readonly loading = this.security.loading;

  readonly revoking = signal<ReadonlySet<string>>(new Set());

  /**
   * Enrolment is a short wizard, so its stage lives here rather than a route.
   *
   * `confirming-password` exists because enrolment costs the account password,
   * not just a live session. `awaiting-email-code` is the email factor's
   * equivalent of `scanning`: the step where the user goes and fetches the
   * thing that proves they hold the factor.
   */
  readonly setupStage = signal<
    | 'idle'
    | 'confirming-password'
    | 'scanning'
    | 'awaiting-email-code'
    | 'recovery'
  >('idle');

  /** Which factor the wizard is currently enrolling. */
  readonly setupMethod = signal<TwoFactorMethod>('totp');

  readonly setupSecret = signal<string | null>(null);
  readonly setupUri = signal<string | null>(null);
  readonly recoveryCodes = signal<string[]>([]);
  readonly code = signal('');

  /** Where the enrolment code was sent, for the "check your inbox" line. */
  readonly emailSentTo = signal<string | null>(null);

  /**
   * Re-entered to add or remove a second factor. Never persisted — held only
   * for the duration of the request and cleared on every exit path.
   */
  readonly password = signal('');
  readonly busy = signal(false);

  /** Which factor is being turned off, or null. */
  readonly disarmingMethod = signal<TwoFactorMethod | 'all' | null>(null);
  readonly disarming = computed(() => this.disarmingMethod() !== null);

  readonly currentUser = this.authService.user;

  // ── Password change ─────────────────────────────────────────────────────────

  readonly changingPassword = signal(false);
  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');

  /**
   * Every reason the new password cannot be submitted yet, or an empty list.
   *
   * The rules come from `describePasswordProblems`, which is the same module the
   * sign-up form validates against and a mirror of the server's
   * `password-policy`. This panel used to carry a private copy of the
   * *composition* checklist — lowercase, uppercase, digit, one of `@$!%*?&` —
   * which the rest of the codebase abandoned as counterproductive and which the
   * server does not enforce. See the note on `describePasswordProblems` for
   * what that cost in both directions.
   *
   * All of them, not the first: the old version returned a single string, so a
   * password with three faults was fixed one round of retyping at a time, each
   * revealing the next rule.
   */
  readonly passwordProblems = computed<string[]>(() => {
    const current = this.currentPassword();
    const next = this.newPassword();
    const confirmation = this.confirmPassword();

    // Silent while the fields are still being filled in — a policy recited at
    // someone who has typed two characters is noise, not guidance.
    if (!current || !next) return [];

    const user = this.currentUser();
    const problems = describePasswordProblems(next, {
      username: user?.username,
      email: user?.email,
    });

    if (next === current) {
      problems.push('Choose a password you have not used here before.');
    }

    if (confirmation && next !== confirmation) {
      problems.push('The two new passwords do not match.');
    }

    return problems;
  });

  /** The first reason, for the single line the panel has room for. */
  readonly passwordProblem = computed<string | null>(
    () => this.passwordProblems()[0] ?? null,
  );

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

    // `passwordProblems` is empty while fields are still empty so the form does
    // not shout at someone who has only started typing; submission is where
    // completeness actually has to be checked.
    if (!current || !next || !confirmation) {
      toast.error(
        !current
          ? 'Enter your current password.'
          : !next
            ? 'Enter the new password you want.'
            : 'Re-enter the new password to confirm it.',
      );
      return;
    }

    /*
     * This was a bare `return`. The button is disabled while a problem stands,
     * so the path was only reachable by pressing Enter in a field — and it
     * ended the submit with no request, no toast and no change to the screen.
     * The reason was rendered above the button, but a user who had scrolled
     * past it saw a form that simply did not respond.
     */
    const problems = this.passwordProblems();
    if (problems.length > 0) {
      toast.error('That password cannot be used', {
        description: problems.join(' '),
      });
      return;
    }

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
        toast.error(apiErrorMessage(err, 'Could not change your password'));
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
    this.readLinkResult();
  }

  // ── Password-less accounts ──────────────────────────────────────────────────

  /**
   * False only for an account created through Google or GitHub that has not
   * chosen a password. Defaults to true while the user is loading, or against
   * an API that does not report it, so nothing is hidden by mistake.
   */
  readonly hasPassword = computed(
    () => this.currentUser()?.has_password !== false,
  );

  /**
   * A first password arrives through the reset link rather than a form here.
   * The link proves the inbox; a form would let anyone holding this session
   * set a password — the same reason every password-gated action asks for one.
   */
  sendSetPasswordLink(): void {
    const email = this.currentUser()?.email;
    if (!email) return;

    this.busy.set(true);
    this.authService.forgotPassword(email).subscribe({
      next: () => {
        this.busy.set(false);
        toast.success('Check your inbox', {
          description: `We sent a link to ${email}. Setting your password signs you out on every device.`,
        });
      },
      error: (err) => {
        this.busy.set(false);
        toast.error(apiErrorMessage(err, 'Could not send the link'));
      },
    });
  }

  // ── Connected accounts ──────────────────────────────────────────────────────

  private readonly enabledProviders = injectEnabledOidcProviders();

  /**
   * One row per provider the server offers, plus any already connected that
   * it no longer does — a connection must stay removable after its provider is
   * switched off.
   */
  readonly providerRows = computed(() => {
    const connected = this.currentUser()?.providers ?? [];
    const names = [
      ...new Set<OidcProvider>([...this.enabledProviders(), ...connected]),
    ];
    return names.map((name) => ({
      name,
      ...OIDC_PROVIDER_DETAILS[name],
      connected: connected.includes(name),
    }));
  });

  /** The provider whose connect/disconnect is waiting on the password. */
  readonly identityAction = signal<{
    provider: OidcProvider;
    kind: 'connect' | 'disconnect';
  } | null>(null);
  readonly identityPassword = signal('');

  beginIdentityAction(
    provider: OidcProvider,
    kind: 'connect' | 'disconnect',
  ): void {
    this.identityAction.set({ provider, kind });
    this.identityPassword.set('');
  }

  cancelIdentityAction(): void {
    this.identityAction.set(null);
    this.identityPassword.set('');
  }

  confirmIdentityAction(): void {
    const action = this.identityAction();
    const password = this.identityPassword();
    if (!action) return;
    if (!password) {
      toast.error('Enter your password.');
      return;
    }

    const label = OIDC_PROVIDER_DETAILS[action.provider].label;
    this.busy.set(true);

    if (action.kind === 'connect') {
      this.security.linkOidc(action.provider, password).subscribe({
        // The provider sends the browser back here with ?linked= or
        // ?link_error=, read by readLinkResult on the way in.
        next: ({ url }) => window.location.assign(url),
        error: (err) => {
          this.busy.set(false);
          this.identityPassword.set('');
          toast.error(apiErrorMessage(err, `Could not connect ${label}`));
        },
      });
      return;
    }

    this.security.unlinkOidc(action.provider, password).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.cancelIdentityAction();
        toast.success(res?.message ?? `${label} was disconnected.`);
        this.authService.refreshCurrentUser().subscribe();
      },
      error: (err) => {
        this.busy.set(false);
        this.identityPassword.set('');
        toast.error(apiErrorMessage(err, `Could not disconnect ${label}`));
      },
    });
  }

  /**
   * The far end of a connect: the provider round trip lands back on this
   * page. Reported once, then removed from the URL so a reload does not
   * announce it again.
   */
  private readLinkResult(): void {
    const params = this.route.snapshot.queryParamMap;
    const linked = params.get('linked');
    const error = params.get('link_error');
    if (!linked && !error) return;

    if (isOidcProvider(linked)) {
      toast.success(`${OIDC_PROVIDER_DETAILS[linked].label} connected.`);
      this.authService.refreshCurrentUser().subscribe();
    } else if (error) {
      toast.error(LINK_ERROR_MESSAGES[error] ?? LINK_ERROR_MESSAGES['oidc_failed']);
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { linked: null, link_error: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
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
      error: (err) => {
        this.markRevoking(session.id, false);
        toast.error(apiErrorMessage(err, 'Could not sign that session out'));
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
      error: (err) => {
        this.busy.set(false);
        toast.error(apiErrorMessage(err, 'Could not sign out everywhere'));
      },
    });
  }

  /** Opens the password prompt that precedes enrolling `method`. */
  beginSetup(method: TwoFactorMethod): void {
    this.setupMethod.set(method);
    this.setupStage.set('confirming-password');
    this.password.set('');
    this.code.set('');
    this.emailSentTo.set(null);
  }

  /**
   * Second step of enrolment, once the password is in hand.
   *
   * The password is passed exactly as typed. It used to be `.trim()`ed here,
   * which silently mangled any password with a leading or trailing space — the
   * server compares against the hash of the real one, so those accounts got
   * "That password is not correct" for the password they had just used to sign
   * in, with nothing on screen to explain it.
   */
  startTwoFactorSetup(): void {
    const password = this.password();
    if (!password) return;

    this.busy.set(true);

    if (this.setupMethod() === 'email') {
      this.security.beginEmailTwoFactorSetup(password).subscribe({
        next: (sent) => {
          this.emailSentTo.set(sent.sent_to);
          this.setupStage.set('awaiting-email-code');
          this.code.set('');
          /*
           * The password is deliberately *kept* through this stage.
           *
           * It used to be cleared here, and `resendEmailSetupCode` reads the
           * same signal — so the resend button found it empty every time,
           * showed "Re-enter your password to send another code" and threw the
           * user back to the password step. There was no path where it did what
           * it said. It is still cleared on every exit: confirm, cancel and
           * finish below.
           */
          this.busy.set(false);
        },
        error: (err) => {
          this.busy.set(false);
          toast.error(apiErrorMessage(err, 'Could not send a code'));
        },
      });
      return;
    }

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
        toast.error(apiErrorMessage(err, 'Could not start two-factor setup'));
      },
    });
  }

  confirmTwoFactorSetup(): void {
    const code = this.code().trim();
    if (code.length !== 6) return;

    const method = this.setupMethod();
    const request$ =
      method === 'email'
        ? this.security.confirmEmailTwoFactorSetup(code)
        : this.security.confirmTwoFactorSetup(code);

    this.busy.set(true);
    request$.subscribe({
      next: (res) => {
        this.setupSecret.set(null);
        this.setupUri.set(null);
        this.code.set('');
        // Held through the email stage for the resend; done with now.
        this.password.set('');
        this.busy.set(false);

        // Codes come back only the first time a factor is confirmed. Adding a
        // second factor keeps the set the user already wrote down, so there is
        // nothing to show and the wizard just closes.
        if (res.recovery_codes.length > 0) {
          this.recoveryCodes.set(res.recovery_codes);
          this.setupStage.set('recovery');
        } else {
          this.setupStage.set('idle');
          toast.success(
            method === 'email'
              ? 'Email codes turned on'
              : 'Authenticator app turned on',
          );
        }
      },
      error: (err) => {
        this.busy.set(false);
        toast.error(apiErrorMessage(err, 'That code is not correct'));
      },
    });
  }

  /** Sends another enrolment code, for a mail that never arrived. */
  resendEmailSetupCode(): void {
    const password = this.password();
    if (!password) {
      toast.error('Re-enter your password to send another code.');
      this.setupStage.set('confirming-password');
      return;
    }

    this.busy.set(true);
    this.security.beginEmailTwoFactorSetup(password).subscribe({
      next: (sent) => {
        this.emailSentTo.set(sent.sent_to);
        this.busy.set(false);
        toast.success('Another code is on its way');
      },
      error: (err) => {
        this.busy.set(false);
        toast.error(apiErrorMessage(err, 'Could not send another code'));
      },
    });
  }

  finishSetup(): void {
    this.setupStage.set('idle');
    this.recoveryCodes.set([]);
    this.password.set('');
  }

  cancelSetup(): void {
    this.setupStage.set('idle');
    this.setupSecret.set(null);
    this.setupUri.set(null);
    this.emailSentTo.set(null);
    this.code.set('');
    this.password.set('');
  }

  beginDisable(method: TwoFactorMethod | 'all'): void {
    this.disarmingMethod.set(method);
    this.code.set('');
    this.password.set('');
    this.emailSentTo.set(null);
  }

  /**
   * Mails a code to authorise the removal in progress.
   *
   * Offered whenever the email factor is on — and it is the only route for
   * someone whose *only* factor is email, since they have no authenticator to
   * read a code from and the sign-in send needs a challenge they do not have.
   */
  sendDisableEmailCode(): void {
    this.busy.set(true);
    this.security.sendEmailTwoFactorChallenge().subscribe({
      next: (sent) => {
        this.emailSentTo.set(sent.sent_to);
        this.busy.set(false);
        toast.success('A code is on its way');
      },
      error: (err) => {
        this.busy.set(false);
        toast.error(apiErrorMessage(err, 'Could not send a code'));
      },
    });
  }

  cancelDisable(): void {
    this.disarmingMethod.set(null);
    this.code.set('');
    this.password.set('');
  }

  /** What turning off the currently-selected factor would leave behind. */
  readonly disarmLeavesAccountBare = computed(() => {
    const method = this.disarmingMethod();
    if (method === null) return false;
    if (method === 'all') return true;

    return this.twoFactor().methods.filter((m) => m !== method).length === 0;
  });

  confirmDisable(): void {
    const method = this.disarmingMethod();
    const code = this.code().trim();
    // Not trimmed: see startTwoFactorSetup.
    const password = this.password();
    if (method === null || !code || !password) return;

    this.busy.set(true);
    this.security
      .disableTwoFactor(code, password, method === 'all' ? undefined : method)
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.disarmingMethod.set(null);
          this.code.set('');
          this.password.set('');

          toast.success(
            method === 'email'
              ? 'Email codes turned off'
              : method === 'totp'
                ? 'Authenticator app turned off'
                : 'Two-factor authentication turned off',
          );

          // Only dropping to a bare password revokes every session — removing
          // one of two factors leaves this one signed in, so bouncing to the
          // login screen unconditionally would be a lie about what happened.
          if (res.signedOut) this.authService.handleAuthFailure();
        },
        error: (err) => {
          this.busy.set(false);
          toast.error(apiErrorMessage(err, 'That code is not correct'));
        },
      });
  }

  copyRecoveryCodes(): void {
    navigator.clipboard
      ?.writeText(this.recoveryCodes().join('\n'))
      .then(() => toast.success('Recovery codes copied'))
      .catch(() => toast.error('Could not copy'));
  }

  /** See LoginComponent.onTwoFactorCodeInput — the element needs correcting too. */
  onCodeInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const cleaned = el.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 11);
    if (el.value !== cleaned) el.value = cleaned;
    this.code.set(cleaned);
  }

  private markRevoking(id: string, active: boolean): void {
    this.revoking.update((ids) => {
      const next = new Set(ids);
      active ? next.add(id) : next.delete(id);
      return next;
    });
  }
}
