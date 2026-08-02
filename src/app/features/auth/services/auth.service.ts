import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import {
  catchError,
  Observable,
  tap,
  throwError,
  switchMap,
  of,
  EMPTY,
  shareReplay,
  finalize,
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
import { Router } from '@angular/router';
import { UnlockAccountI } from '../interfaces/unlock-account.interface';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
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
      this.loadCurrentUser().subscribe();
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
        this.handleAuthFailure();
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

  login(credentials: LoginCredentialsI): Observable<UserI> {
    this.#loading.set(true);
    this.#error.set(null);
    return this.http.post<AuthResponseI>(this._LOGIN_URL, credentials).pipe(
      switchMap(() => {
        this.#loading.set(false);
        localStorage.setItem(this.IS_AUTHENTICATED_KEY, 'true');
        this.isAuthenticated.set(true);
        // loadCurrentUser() already connects the socket and announces presence
        return this.loadCurrentUser().pipe(
          tap(() => this.router.navigateByUrl('/messages')),
        );
      }),
      catchError(this.handleError),
    );
  }

  verifyEmail(token: string, id: string): Observable<MessageResponseI> {
    return this.http
      .post<MessageResponseI>(this._VERIFY_EMAIL_URL, { token, id })
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
          this.handleAuthFailure();
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

  logOut(): Observable<AuthResponseI> {
    this.#loading.set(true);
    return this.http.post<AuthResponseI>(this._LOGOUT_URL, {}).pipe(
      tap(() => {
        this.router.navigateByUrl('');
        this.clearAppState();
      }),
      catchError(this.handleError.bind(this)),
    );
  }

  // Public so authInterceptor can call it on reuse detection
  handleAuthFailure(): void {
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
    localStorage.clear();
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
