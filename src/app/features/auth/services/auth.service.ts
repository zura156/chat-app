import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import {
  catchError,
  Observable,
  tap,
  throwError,
  switchMap,
  of,
  shareReplay,
  finalize,
  retry,
  timer,
  map,
} from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RegisterCredentialsI } from '../interfaces/register-credentials.interface';
import { LoginCredentialsI } from '../interfaces/login-credentials.interface';
import { WebSocketService } from '../../messages/services/web-socket.service';
import { NotificationService } from '../../messages/services/notification.service';
import {
  UploadReadyMessage,
  UserStatusMessage,
} from '../../messages/interfaces/web-socket-message.interface';
import { UserStateService } from '../../user/services/user-state.service';
import { MessageResponseI } from '../../../shared/interfaces/message-response.interface';
import { ResetPasswordI } from '../interfaces/reset-password.interface';
import { AuthResponseI } from '../interfaces/auth-response.interface';
import { UserI } from '../../user/interfaces/user.interface';
import { UserService } from '../../user/services/user.service';
import { ActivatedRoute, Router } from '@angular/router';
import { UnlockAccountI } from '../interfaces/unlock-account.interface';

/** Keys that belong to a session and must not outlive it. */
const SESSION_STORAGE_KEYS = ['isAuthenticated', 'prefers-chat-settings-open'];

/**
 * Whether a failure means the session is genuinely over, as opposed to the
 * network or the server having a moment.
 *
 * Everything here used to sign the user out on *any* error, so a 429 from the
 * rate limiter dumped them on the login screen — with their cookies still live,
 * because nothing told the server. Only 401 is the server saying the
 * credentials are no longer good: `/auth/refresh` answers 401 for every real
 * end-of-session (missing, expired, revoked, reused), while 429, 0, 408 and 5xx
 * all describe a session that is still perfectly valid.
 */
const isSessionOver = (error: unknown): boolean =>
  (error as HttpErrorResponse)?.status === 401;

/** Honours the server's Retry-After when there is one, capped so a long
 *  cooldown does not park a retry for half an hour. */
const backoffMs = (error: unknown): number => {
  const retryAfter = (error as HttpErrorResponse)?.error?.retryAfter;
  return typeof retryAfter === 'number'
    ? Math.min(retryAfter * 1000, 30_000)
    : 2_000;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userStateService = inject(UserStateService);
  private userService = inject(UserService);
  private webSocketService = inject(WebSocketService);
  private notificationService = inject(NotificationService);

  private readonly _LOGIN_URL = `${environment.apiUrl}/auth/login`;
  private readonly _REGISTER_URL = `${environment.apiUrl}/auth/register`;
  private readonly _LOGOUT_URL = `${environment.apiUrl}/auth/logout`;
  private readonly _FORGOT_PASSWORD_URL = `${environment.apiUrl}/auth/forgot-password`;
  private readonly _RESET_PASSWORD_URL = `${environment.apiUrl}/auth/reset-password`;
  private readonly _UNLOCK_ACCOUNT_URL = `${environment.apiUrl}/auth/unlock-account`;
  private readonly _VERIFY_EMAIL_URL = `${environment.apiUrl}/auth/verify-email`;
  private readonly _REFRESH_TOKEN_URL = `${environment.apiUrl}/auth/refresh`;

  private readonly IS_AUTHENTICATED_KEY = 'isAuthenticated';

  #loading = signal<boolean>(false);
  #error = signal<string | null>(null);

  public readonly user = this.userStateService.currentUser;
  public readonly loading = this.#loading.asReadonly();
  public readonly error = this.#error.asReadonly();
  public readonly isAuthenticated = signal(
    localStorage.getItem(this.IS_AUTHENTICATED_KEY) === 'true',
  );
  public readonly isEmailVerified = computed(
    () => this.user()?.is_email_verified ?? false,
  );

  private refreshInFlight$: Observable<any> | null = null;
  private isRefreshing = false;

  init(): void {
    if (this.isAuthenticated()) {
      // Boot is the one place a transient failure really costs: give up here
      // and a signed-in user has no profile for the rest of the session. One
      // retry, spaced by whatever the server asked for when it was a rate
      // limit; a dead session (401) has already been handled and must not be
      // retried.
      this.loadCurrentUser()
        .pipe(
          retry({
            count: 1,
            delay: (error) =>
              isSessionOver(error)
                ? throwError(() => error)
                : timer(backoffMs(error)),
          }),
        )
        .subscribe({ error: () => undefined });
    }
    this.setupUnloadListener();

    // The server only knows we are back when we say so — without this the
    // account stays "offline" for everyone else after any reconnect.
    this.webSocketService.onReconnect().subscribe(() => {
      const user = this.user();
      if (user) this.announcePresence(user._id);
    });

    // Avatars are processed asynchronously; this is when the new URL exists.
    this.webSocketService
      .onMessageOfType<UploadReadyMessage>('upload-ready')
      .subscribe((msg) => {
        if (msg.context === 'avatar' && msg.variants?.['medium']) {
          this.userService.applyProfilePicture(msg.variants['medium']);
        }
      });
  }

  private loadCurrentUser() {
    return this.userService.getCurrentUser().pipe(
      tap((user) => {
        this.userStateService.setCurrentUser(user);
        this.connectWS(user._id);
      }),
      catchError((err) => {
        if (isSessionOver(err)) this.handleAuthFailure();
        return throwError(() => err);
      }),
    );
  }

  private setupUnloadListener(): void {
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
  }

  handleBeforeUnload(): void {
    localStorage.setItem(
      this.IS_AUTHENTICATED_KEY,
      String(this.isAuthenticated()),
    );
    const user = this.user();
    if (user) {
      this.webSocketService.sendMessage({
        type: 'user-status',
        user_id: user._id,
        status: 'offline',
        last_seen: new Date().toISOString(),
      } as UserStatusMessage);
    }
  }

  register(credentials: RegisterCredentialsI): Observable<AuthResponseI> {
    this.#loading.set(true);
    this.#error.set(null);
    return this.http.post<AuthResponseI>(this._REGISTER_URL, credentials).pipe(
      tap(() => this.#loading.set(false)),
      catchError(this.handleError),
    );
  }

  /**
   * True once the password has been accepted but a second factor is still
   * outstanding. The login screen swaps to the code step on this rather than
   * routing, so the challenge cookie's short life is not spent on a navigation.
   */
  readonly twoFactorRequired = signal(false);

  login(credentials: LoginCredentialsI): Observable<UserI | null> {
    this.#loading.set(true);
    this.#error.set(null);
    this.twoFactorRequired.set(false);

    return this.http.post<AuthResponseI>(this._LOGIN_URL, credentials).pipe(
      switchMap((response) => {
        // The password was right but it is not sufficient on this account. No
        // session exists yet, so nothing may be marked authenticated here.
        if ((response as { two_factor_required?: boolean })?.two_factor_required) {
          this.#loading.set(false);
          this.twoFactorRequired.set(true);
          return of(null);
        }

        return this.completeLogin();
      }),
      catchError(this.handleError),
    );
  }

  /** Second step: exchanges an authenticator or recovery code for a session. */
  submitTwoFactorCode(code: string): Observable<UserI | null> {
    this.#loading.set(true);
    this.#error.set(null);

    return this.http
      .post<AuthResponseI>(`${environment.apiUrl}/auth/login/2fa`, { code })
      .pipe(
        switchMap(() => {
          this.twoFactorRequired.set(false);
          return this.completeLogin();
        }),
        catchError(this.handleError),
      );
  }

  cancelTwoFactor(): void {
    this.twoFactorRequired.set(false);
    this.#error.set(null);
  }

  private completeLogin(): Observable<UserI> {
    this.#loading.set(false);
    localStorage.setItem(this.IS_AUTHENTICATED_KEY, 'true');
    this.isAuthenticated.set(true);

    // The guard records where the user was headed; sending everyone to
    // /messages regardless meant every deep link was silently discarded at the
    // login screen.
    const returnUrl =
      this.route.snapshot.queryParamMap.get('returnUrl') ?? '/messages';

    // loadCurrentUser() already connects the socket and announces presence
    return this.loadCurrentUser().pipe(
      tap(() => this.router.navigateByUrl(returnUrl)),
    );
  }

  verifyEmail(token: string, id: string): Observable<MessageResponseI> {
    return this.http
      .post<MessageResponseI>(this._VERIFY_EMAIL_URL, { token, id })
      .pipe(catchError(this.handleError));
  }

  /**
   * Sends a fresh verification link. Needed because links expire after an hour
   * and the original mail is easy to lose — without this, an account gated on
   * verification has no way back in.
   */
  resendVerificationEmail(): Observable<MessageResponseI> {
    return this.http
      .post<MessageResponseI>(
        `${environment.apiUrl}/auth/resend-verification`,
        {},
      )
      .pipe(catchError(this.handleError));
  }

  /** Re-reads the current user, e.g. after verifying in another tab. */
  refreshCurrentUser(): Observable<UserI> {
    return this.loadCurrentUser();
  }

  /**
   * Requests a move to a new address. Nothing changes until the link mailed to
   * that address is opened — see `confirmEmailChange`.
   */
  changeEmail(newEmail: string, password: string): Observable<MessageResponseI> {
    return this.http
      .post<MessageResponseI>(`${environment.apiUrl}/auth/change-email`, {
        new_email: newEmail,
        password,
      })
      .pipe(
        // The pending address is part of the user record the account screen
        // renders, so it has to be re-read for the banner to appear.
        switchMap((res) => this.loadCurrentUser().pipe(map(() => res))),
        catchError(this.handleError),
      );
  }

  cancelEmailChange(): Observable<MessageResponseI> {
    return this.http
      .post<MessageResponseI>(
        `${environment.apiUrl}/auth/cancel-email-change`,
        {},
      )
      .pipe(
        switchMap((res) => this.loadCurrentUser().pipe(map(() => res))),
        catchError(this.handleError),
      );
  }

  /**
   * Redeems the link from the new inbox. Unauthenticated: the mail client
   * usually opens it in a browser with no session, and the server signs every
   * device out on success anyway.
   */
  confirmEmailChange(token: string, id: string): Observable<MessageResponseI> {
    return this.http
      .post<MessageResponseI>(`${environment.apiUrl}/auth/confirm-email`, {
        token,
        id,
      })
      .pipe(catchError(this.handleError));
  }

  forgotPassword(email: string): Observable<AuthResponseI> {
    return this.http.post<AuthResponseI>(this._FORGOT_PASSWORD_URL, { email });
  }

  resetPassword(body: ResetPasswordI): Observable<MessageResponseI> {
    return this.http
      .post<MessageResponseI>(this._RESET_PASSWORD_URL, body)
      .pipe(catchError(this.handleError));
  }

  unlockAccount(body: UnlockAccountI): Observable<MessageResponseI> {
    return this.http
      .post<MessageResponseI>(this._UNLOCK_ACCOUNT_URL, body)
      .pipe(catchError(this.handleError));
  }

  // Called by authInterceptor on 401 — no retry logic here
  refreshToken(): Observable<MessageResponseI> {
    if (this.isRefreshing && this.refreshInFlight$)
      return this.refreshInFlight$;

    this.isRefreshing = true;

    this.refreshInFlight$ = this.http
      .post<MessageResponseI>(this._REFRESH_TOKEN_URL, {})
      .pipe(
        catchError((error) => {
          // A refresh that was rate limited or that never reached the server
          // says nothing about whether the session is still good — the tokens
          // are untouched and the next attempt will work. Signing out here is
          // what turned a 429 into a logout.
          if (isSessionOver(error)) this.handleAuthFailure();
          return throwError(() => error);
        }),
        finalize(() => {
          this.isRefreshing = false;
          this.refreshInFlight$ = null;
        }),
        shareReplay(1),
      );

    return this.refreshInFlight$;
  }

  /**
   * Signing out must always succeed locally.
   *
   * The server call was the only thing that cleared client state, so once the
   * access token expired the request came back 401 — and because /auth/logout
   * is excluded from the interceptor's refresh-and-retry, nothing recovered.
   * The user stayed "signed in" in the UI with no way to correct it. The
   * server now tolerates an expired token; this tolerates the request failing
   * for any other reason.
   */
  logOut(): Observable<AuthResponseI | null> {
    this.#loading.set(true);
    return this.revokeServerSession().pipe(
      tap(() => {
        this.clearAppState();
        this.router.navigateByUrl('/auth/login');
      }),
    );
  }

  /**
   * Revokes the refresh token and clears the auth cookies, best effort.
   *
   * Never fails the caller: signing out must always succeed locally. The server
   * call was once the only thing that cleared client state, so an expired access
   * token came back 401 and — because /auth/logout is excluded from the
   * interceptor's refresh-and-retry — nothing recovered and the user stayed
   * "signed in" with no way to correct it.
   */
  private revokeServerSession(): Observable<AuthResponseI | null> {
    return this.http
      .post<AuthResponseI>(this._LOGOUT_URL, {})
      .pipe(catchError(() => of(null)));
  }

  // Public so authInterceptor can call it on reuse detection
  handleAuthFailure(): void {
    // The server holds the other half of a sign-out. Clearing local state alone
    // left the accessToken, refreshToken and csrfToken cookies in the browser,
    // so the app said "logged out" while the session it was hiding was still
    // live — and the next visit started from that half-dead state.
    this.revokeServerSession().subscribe();
    this.clearAppState();
    this.router.navigateByUrl('/auth/login');
  }

  private connectWS(userId: string): void {
    this.webSocketService.connect();
    this.announcePresence(userId);
    // Seed unread counts once per session; realtime `notification` events keep
    // them current from here on.
    this.notificationService.load().subscribe();
  }

  private announcePresence(userId: string): void {
    this.webSocketService.sendMessage({
      type: 'user-status',
      user_id: userId,
      status: 'online',
      last_seen: new Date().toISOString(),
    } as UserStatusMessage);
  }

  private clearAppState(): void {
    this.userStateService.setCurrentUser(null);
    this.notificationService.reset();
    this.webSocketService.close();

    // Only session keys. `localStorage.clear()` also wiped the user's theme and
    // accent colour, so signing out silently reset their appearance settings —
    // which are a device preference, not part of the session.
    for (const key of SESSION_STORAGE_KEYS) localStorage.removeItem(key);
    sessionStorage.removeItem('selectedUser');

    localStorage.setItem(this.IS_AUTHENTICATED_KEY, 'false');
    this.isAuthenticated.set(false);
    this.#loading.set(false);
  }

  private handleError = (error: HttpErrorResponse) => {
    this.#loading.set(false);
    let errorMessage = 'An unknown error occurred';
    if (error.error?.message) errorMessage = error.error.message;
    else if (error.error?.errors?.length > 0)
      errorMessage = error.error.errors.map((e: any) => e.msg).join(', ');
    else if (error.message) errorMessage = error.message;
    this.#error.set(errorMessage);
    return throwError(() => errorMessage);
  };
}
