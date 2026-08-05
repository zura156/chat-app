import { Service, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface SessionI {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_used_at: string;
  current: boolean;
}

export interface TwoFactorStatusI {
  enabled: boolean;
  pending: boolean;
  recovery_codes_remaining: number;
}

export interface TwoFactorSetupI {
  secret: string;
  otpauth_uri: string;
  expires_at: string;
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
    pending: false,
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
      .post<{ enabled: boolean; recovery_codes: string[] }>(
        `${this.authUrl}/2fa/confirm`,
        { code },
      )
      .pipe(
        tap((res) =>
          this._twoFactor.set({
            enabled: true,
            pending: false,
            recovery_codes_remaining: res.recovery_codes.length,
          }),
        ),
      );
  }

  disableTwoFactor(code: string, password: string) {
    return this.http
      .request<{ enabled: boolean }>(
        'delete',
        `${this.authUrl}/2fa`,
        { body: { code, password } },
      )
      .pipe(
        tap(() =>
          this._twoFactor.set({
            enabled: false,
            pending: false,
            recovery_codes_remaining: 0,
          }),
        ),
      );
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
