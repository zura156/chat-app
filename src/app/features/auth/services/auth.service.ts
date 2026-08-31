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
import { TwoFactorMethod } from '../interfaces/two-factor.interface';
import { apiErrorMessage } from '../../../shared/functions/api-error';

/** Keys that belong to a session and must not outlive it. */
const SESSION_STORAGE_KEYS = ['isAuthenticated', 'prefers-chat-settings-open'];

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

  readonly twoFactorRequired = signal(false);

  /** Which factors this account can answer with — one entry, or both. */
  readonly twoFactorMethods = signal<TwoFactorMethod[]>([]);

  /** The one the code field is currently asking for. */
  readonly twoFactorMethod = signal<TwoFactorMethod>('totp');

  login(credentials: LoginCredentialsI): Observable<UserI | null> {
    this.#loading.set(true);
    this.#error.set(null);
    this.twoFactorRequired.set(false);

    return this.http.post<AuthResponseI>(this._LOGIN_URL, credentials).pipe(
      switchMap((response) => {
        // The password was right but it is not sufficient on this account. No
        // session exists yet, so nothing may be marked authenticated here.
        const challenge = response as {
          two_factor_required?: boolean;
          methods?: TwoFactorMethod[];
          default_method?: TwoFactorMethod;
        };

        if (challenge?.two_factor_required) {
          this.#loading.set(false);
          // Falls back to the authenticator when the server says nothing, so an
          // older API keeps working rather than rendering an empty chooser.
          const methods = challenge.methods?.length
            ? challenge.methods
            : (['totp'] as TwoFactorMethod[]);
          this.twoFactorMethods.set(methods);
          this.twoFactorMethod.set(challenge.default_method ?? methods[0]);
          this.twoFactorRequired.set(true);
          return of(null);
        }

        return this.completeLogin();
      }),
      catchError(this.handleError),
    );
  }

  submitTwoFactorCode(
    code: string,
    method = this.twoFactorMethod(),
  ): Observable<UserI | null> {
    this.#loading.set(true);
    this.#error.set(null);

    return this.http
      .post<AuthResponseI>(`${environment.apiUrl}/auth/login/2fa`, {
        code,
        method,
      })
      .pipe(
        switchMap(() => {
          this.twoFactorRequired.set(false);
          return this.completeLogin();
        }),
        catchError(this.handleError),
      );
  }

  requestTwoFactorEmailCode(): Observable<{ message: string }> {
    return this.http
      .post<{
        message: string;
      }>(`${environment.apiUrl}/auth/login/2fa/email`, {})
      .pipe(catchError(this.handleError));
  }

  /** Switches which factor the user is answering, mid-challenge. */
  chooseTwoFactorMethod(method: TwoFactorMethod): void {
    this.twoFactorMethod.set(method);
    this.#error.set(null);
  }

  cancelTwoFactor(): void {
    this.twoFactorRequired.set(false);
    this.twoFactorMethods.set([]);
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
  changeEmail(
    newEmail: string,
    password: string,
  ): Observable<MessageResponseI> {
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
    return this.http
      .post<AuthResponseI>(this._FORGOT_PASSWORD_URL, { email })
      .pipe(catchError(this.handleError));
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

  public handleAuthFailure(): void {
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

    for (const key of SESSION_STORAGE_KEYS) localStorage.removeItem(key);
    sessionStorage.removeItem('selectedUser');

    localStorage.setItem(this.IS_AUTHENTICATED_KEY, 'false');
    this.isAuthenticated.set(false);
    this.#loading.set(false);
  }

  private handleError = (error: HttpErrorResponse) => {
    this.#loading.set(false);
    this.#error.set(apiErrorMessage(error, 'An unknown error occurred'));
    return throwError(() => error);
  };
}
