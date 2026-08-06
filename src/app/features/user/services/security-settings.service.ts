import { Service, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { TwoFactorMethod } from '../../auth/interfaces/two-factor.interface';

export interface SessionI {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_used_at: string;
  current: boolean;
}

export type { TwoFactorMethod };

export interface TwoFactorStatusI {
  /** Any factor at all — what the screen's on/off summary reads. */
  enabled: boolean;
  methods: TwoFactorMethod[];
  totp_enabled: boolean;
  email_enabled: boolean;
  /** An authenticator enrolment that was started and never confirmed. */
  totp_pending: boolean;
  recovery_codes_remaining: number;
}

export interface TwoFactorSetupI {
  secret: string;
  otpauth_uri: string;
  expires_at: string;
}

/**
 * Confirming either factor returns the new status, plus recovery codes — but
 * only the first time. Adding a second factor to an account that already has
 * one leaves the existing codes alone, so the array comes back empty and the
 * screen must not present that as "here are your codes".
 */
export interface TwoFactorConfirmI extends TwoFactorStatusI {
  recovery_codes: string[];
}

export interface EmailCodeSentI {
  sent_to: string;
  expires_in_seconds: number;
}

/**
 * Backs the security screen, which previously rendered a hardcoded login
 * history — invented cities, invented devices, one flagged as the current
 * session — and a 2FA switch that only flipped a local signal.
 */
@Service()
export class SecuritySettingsService {
  private readonly http = inject(HttpClient);
  private readonly authUrl = `${environment.apiUrl}/auth`;

  private readonly _sessions = signal<SessionI[]>([]);
  readonly sessions = this._sessions.asReadonly();

  private readonly _twoFactor = signal<TwoFactorStatusI>({
    enabled: false,
    methods: [],
    totp_enabled: false,
    email_enabled: false,
    totp_pending: false,
    recovery_codes_remaining: 0,
  });
  readonly twoFactor = this._twoFactor.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  load() {
    this._loading.set(true);
    return this.http
      .get<{ sessions: SessionI[] }>(`${this.authUrl}/sessions`)
      .pipe(
        tap({
          next: (res) => {
            this._sessions.set(res?.sessions ?? []);
            this._loading.set(false);
          },
          error: () => this._loading.set(false),
        }),
      );
  }

  loadTwoFactor() {
    return this.http
      .get<TwoFactorStatusI>(`${this.authUrl}/2fa`)
      .pipe(tap((status) => this._twoFactor.set(status)));
  }

  revokeSession(id: string) {
    return this.http
      .delete(`${this.authUrl}/sessions/${id}`)
      .pipe(
        tap(() =>
          this._sessions.update((sessions) =>
            sessions.filter((session) => session.id !== id),
          ),
        ),
      );
  }

  revokeAllSessions() {
    return this.http.delete(`${this.authUrl}/sessions`);
  }

  /**
   * Rotating a password the user still knows.
   *
   * The app previously had two "Change password" buttons and no way to change a
   * password: both linked to /auth/forgot-password, which sits behind the
   * unauthenticated guard, so a signed-in user — the only kind who can see
   * those buttons — was bounced straight back to /messages.
   *
   * The server signs every *other* device out and reports how many, which is
   * the only feedback that tells the user the rotation actually took effect
   * beyond this browser.
   */
  changePassword(currentPassword: string, newPassword: string) {
    return this.http
      .post<{ message: string; signed_out_sessions: number }>(
        `${this.authUrl}/change-password`,
        { current_password: currentPassword, new_password: newPassword },
      )
      .pipe(
        // Those sessions are gone server-side; re-reading keeps the list on
        // this screen from showing devices that can no longer authenticate.
        tap(() => this.load().subscribe()),
      );
  }

  /**
   * The password is re-checked server-side before a second factor is added or
   * removed: a live session alone used to be enough, which let anyone holding a
   * stolen cookie enrol their own authenticator and lock the owner out.
   */
  beginTwoFactorSetup(password: string) {
    return this.http.post<TwoFactorSetupI>(`${this.authUrl}/2fa/setup`, {
      password,
    });
  }

  confirmTwoFactorSetup(code: string) {
    return this.http
      .post<TwoFactorConfirmI>(`${this.authUrl}/2fa/confirm`, { code })
      .pipe(tap((res) => this.absorbStatus(res)));
  }

  /**
   * Starts the email factor. The address is not a parameter — the server sends
   * to whatever is on the account, so this cannot be pointed at an inbox the
   * owner does not control.
   */
  beginEmailTwoFactorSetup(password: string) {
    return this.http.post<EmailCodeSentI>(`${this.authUrl}/2fa/email/setup`, {
      password,
    });
  }

  /**
   * Sends a code to a signed-in user who is about to change their factors.
   *
   * The route that mails a code during sign-in needs a challenge cookie, which
   * someone already signed in does not have — so without this, an account whose
   * only factor is email had to spend a recovery code to turn it off.
   */
  sendEmailTwoFactorChallenge() {
    return this.http.post<EmailCodeSentI>(
      `${this.authUrl}/2fa/email/send`,
      {},
    );
  }

  confirmEmailTwoFactorSetup(code: string) {
    return this.http
      .post<TwoFactorConfirmI>(`${this.authUrl}/2fa/email/confirm`, { code })
      .pipe(tap((res) => this.absorbStatus(res)));
  }

  /**
   * Turns off one factor, or everything when `method` is omitted.
   *
   * `signedOut` comes back true only when the account has dropped all the way
   * to password-only, which is the case the server revokes every session for.
   * Removing one of two factors leaves this session alive, so the caller must
   * read the flag rather than assume.
   */
  disableTwoFactor(
    code: string,
    password: string,
    method?: TwoFactorMethod,
  ) {
    const path = method ? `${this.authUrl}/2fa/${method}` : `${this.authUrl}/2fa`;

    return this.http
      .request<TwoFactorStatusI & { signedOut: boolean }>('delete', path, {
        body: { code, password },
      })
      .pipe(tap((res) => this.absorbStatus(res)));
  }

  /** Keeps the local status in step with whatever the server just decided. */
  private absorbStatus(status: TwoFactorStatusI): void {
    this._twoFactor.set({
      enabled: status.enabled,
      methods: status.methods ?? [],
      totp_enabled: status.totp_enabled,
      email_enabled: status.email_enabled,
      totp_pending: status.totp_pending,
      recovery_codes_remaining: status.recovery_codes_remaining,
    });
  }

  /**
   * A coarse device label from the user agent. Deliberately not a geolocation
   * lookup: the version this replaced claimed cities it had no way to know.
   */
  describeDevice(userAgent: string | null): string {
    if (!userAgent) return 'Unknown device';

    const mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);
    const browser =
      /Edg\//.test(userAgent) ? 'Edge'
      : /OPR\/|Opera/.test(userAgent) ? 'Opera'
      : /Chrome\//.test(userAgent) ? 'Chrome'
      : /Safari\//.test(userAgent) ? 'Safari'
      : /Firefox\//.test(userAgent) ? 'Firefox'
      : 'Browser';

    const platform =
      /Windows/.test(userAgent) ? 'Windows'
      : /Android/.test(userAgent) ? 'Android'
      : /iPhone|iPad|iPod/.test(userAgent) ? 'iOS'
      : /Mac OS X|Macintosh/.test(userAgent) ? 'macOS'
      : /Linux/.test(userAgent) ? 'Linux'
      : 'Unknown';

    return `${browser} on ${platform}${mobile ? ' (mobile)' : ''}`;
  }

  isMobile(userAgent: string | null): boolean {
    return !!userAgent && /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);
  }
}
