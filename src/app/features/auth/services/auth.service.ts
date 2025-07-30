import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import {
  catchError,
  Observable,
  tap,
  throwError,
  switchMap,
  retry,
  timer,
  Subscription,
} from 'rxjs';
import {
  HttpClient,
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { RegisterCredentialsI } from '../interfaces/register-credentials.interface';
import { LoginCredentialsI } from '../interfaces/login-credentials.interface';
import { Router } from '@angular/router';
import { WebSocketService } from '../../messages/services/web-socket.service';
import { UserStatusMessage } from '../../messages/interfaces/web-socket-message.interface';
import { UserStateService } from '../../user/services/user-state.service';
import { MessageResponseI } from '../../../shared/interfaces/message-response.interface';
import { ResetPasswordI } from '../interfaces/reset-password.interface';
import { AuthResponseI } from '../interfaces/auth-response.interface';
import { UserI } from '../../user/interfaces/user.interface';
import { CSRFTokenI } from '../interfaces/csrf-token.interface';
import { UserService } from '../../user/services/user.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  /*
   * Dependency injections.
   */

  private http = inject(HttpClient);
  private router = inject(Router);
  private userStateService = inject(UserStateService);
  private userService = inject(UserService);
  private webSocketService = inject(WebSocketService);

  /*
   * API Urls.
   */
  private readonly _LOGIN_URL = `${environment.apiUrl}/auth/login`;
  private readonly _REGISTER_URL = `${environment.apiUrl}/auth/register`;
  private readonly _LOGOUT_URL = `${environment.apiUrl}/auth/logout`;
  private readonly _FORGOT_PASSWORD_URL = `${environment.apiUrl}/auth/forgot-password`;
  private readonly _RESET_PASSWORD_URL = `${environment.apiUrl}/auth/reset-password`;
  private readonly _VERIFY_EMAIL_URL = `${environment.apiUrl}/auth/verify-email`;
  private readonly _REFRESH_TOKEN_URL = `${environment.apiUrl}/auth/refresh`;
  private readonly _CSRF_TOKEN_URL = `${environment.apiUrl}/auth/csrf-token`;

  // private readonly LAST_ACTIVE_TIME_KEY = 'lastActiveTime';
  // private readonly AUTO_LOGOUT_TIME = Math.floor(3600 * 1000);
  private readonly IS_AUTHENTICATED_KEY = 'isAuthenticated';
  private refreshTimer: Subscription | null = null;

  /*
   * Signals for reactive state management
   */
  #user = signal<UserI | null>(null);
  #loading = signal<boolean>(false);
  #error = signal<string | null>(null);
  #csrfToken = signal<string | null>(null);

  public readonly user = this.#user.asReadonly();
  public readonly loading = this.#loading.asReadonly();
  public readonly error = this.#error.asReadonly();
  public readonly isAuthenticated = computed(
    () => localStorage.getItem(this.IS_AUTHENTICATED_KEY) === 'true'
  );
  // public readonly isAdmin = computed(() => this.#user()?.role === 'admin');
  public readonly isEmailVerified = computed(
    () => this.#user()?.is_email_verified ?? false
  );

  /*
   * Setting state for authorization and .
   */
  constructor() {
    this.initializeAuth();
    if (this.isAuthenticated()) {
      this.setupUnloadListener();
    }
  }

  private getHttpOptions(): {
    headers: HttpHeaders;
  } {
    let headers = new HttpHeaders();
    const csrfToken = this.#csrfToken();

    if (csrfToken) {
      headers = headers.set('X-CSRF-Token', csrfToken);
    }

    const options: { headers: HttpHeaders; context?: HttpContext } = {
      headers,
    };

    return options;
  }

  private initializeAuth() {
    this.getCSRFToken()
      .pipe(
        switchMap(() =>
          this.userService.getCurrentUser().pipe(
            tap((res) => {
              this.#user.set(res);
              localStorage.setItem(this.IS_AUTHENTICATED_KEY, 'true');

              this.webSocketService.connect(res._id);

              const currentUser = res;

              if (currentUser) {
                const { _id } = currentUser;

                const data: UserStatusMessage = {
                  type: 'user-status',
                  user_id: _id,
                  status: 'online',
                  last_seen: new Date().toISOString(),
                };
                this.webSocketService.sendMessage(data);
              }
            })
          )
        ),
        tap(() => this.startTokenRefresh()),
        catchError(this.handleError)
      )
      .subscribe();
  }

  private getCSRFToken(): Observable<CSRFTokenI> {
    return this.http.get<CSRFTokenI>(this._CSRF_TOKEN_URL).pipe(
      tap(({ csrfToken }) => {
        if (csrfToken) {
          this.#csrfToken.set(csrfToken);
        }
      }),
      catchError(this.handleError)
    );
  }

  /*
  ? Small security feature.
  * it checks before unload, if user info is deleted.
  * if info is deleted from local storage, it will be reloaded.
  */
  private setupUnloadListener(): void {
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
  }

  handleBeforeUnload(): void {
    const currentUser = this.#user();

    if (currentUser) {
      const { _id } = currentUser;

      const data: UserStatusMessage = {
        type: 'user-status',
        user_id: _id,
        status: 'offline',
        last_seen: new Date().toISOString(),
      };
      this.webSocketService.sendMessage(data);
    }

    if (!this.isAuthenticated() && currentUser) {
      localStorage.setItem(this.IS_AUTHENTICATED_KEY, 'true');
    }
  }

  /*
   * Registering new users
   */
  register(credentials: RegisterCredentialsI): Observable<AuthResponseI> {
    this.#loading.set(true);
    this.#error.set(null);

    return this.http
      .post<AuthResponseI>(
        this._REGISTER_URL,
        credentials,
        this.getHttpOptions()
      )
      .pipe(
        tap(() => this.#loading.set(false)),
        catchError(this.handleError)
      );
  }

  /*
   * user authentication
   */
  login(credentials: LoginCredentialsI): Observable<CSRFTokenI> {
    this.#loading.set(true);
    this.#error.set(null);

    return this.http
      .post<AuthResponseI>(this._LOGIN_URL, credentials, this.getHttpOptions())
      .pipe(
        switchMap(({ user }) => {
          this.#loading.set(false);
          if (user) {
            this.#user.set(user);
          }
          localStorage.setItem(this.IS_AUTHENTICATED_KEY, 'true');
          this.startTokenRefresh();

          return this.getCSRFToken();
        }),
        catchError(this.handleError)
      );
  }

  verifyEmail(token: string): Observable<AuthResponseI> {
    return this.http
      .post<AuthResponseI>(
        this._VERIFY_EMAIL_URL,
        { token },
        this.getHttpOptions()
      )
      .pipe(catchError(this.handleError));
  }

  /*
   * Reset password (when unauthorized)
   */
  forgotPassword(email: string): Observable<AuthResponseI> {
    return this.http.post<AuthResponseI>(this._FORGOT_PASSWORD_URL, {
      email,
    });
  }

  resetPassword(body: ResetPasswordI): Observable<MessageResponseI> {
    return this.http.post<MessageResponseI>(this._RESET_PASSWORD_URL, body);
  }

  /*
   * Refresh token management
   */
  refreshToken(): Observable<CSRFTokenI> {
    return this.http
      .post<AuthResponseI>(this._REFRESH_TOKEN_URL, {}, this.getHttpOptions())
      .pipe(
        retry(1),
        catchError((error) => {
          this.handleAuthFailure();
          return this.handleError(error);
        }),
        switchMap(() => this.getCSRFToken())
      );
  }

  private startTokenRefresh() {
    this.stopTokenRefresh();

    this.refreshTimer = timer(14 * 60 * 1000, 14 * 60 * 1000)
      .pipe(switchMap(() => this.refreshToken()))
      .subscribe({
        error: (error) => {
          this.handleAuthFailure();
          this.handleError(error);
        },
      });
  }

  private stopTokenRefresh() {
    if (this.refreshTimer) {
      this.refreshTimer.unsubscribe();
      this.refreshTimer = null;
    }
  }

  /*
   * Loggin user out of session.
   */
  logOut(): Observable<AuthResponseI> {
    this.#loading.set(true);
    localStorage.clear();

    return this.http
      .post<AuthResponseI>(this._LOGOUT_URL, {}, this.getHttpOptions())
      .pipe(
        tap(() => {
          this.#user.set(null);
          this.stopTokenRefresh();
          this.#loading.set(false);
          this.router.navigate(['/login']);
        }),
        catchError(this.handleError.bind(this))
      );
  }

  /*
   * Function to handle error.
   */
  private handleError = (error: HttpErrorResponse) => {
    this.#loading.set(false);
    console.log(error);

    let errorMessage = 'An unknown error occurred';

    if (error.error?.error) {
      errorMessage = error.error.error;
    } else if (error.error?.errors?.length > 0) {
      errorMessage = error.error.errors.map((e: any) => e.msg).join(', ');
    } else if (error.message) {
      errorMessage = error.message;
    }

    this.#error.set(errorMessage);

    // Handle specific error cases
    if (error.status === 401 || error.status === 403) {
      if (error.error?.error === 'Token expired') {
        // Try to refresh token
        this.refreshToken().subscribe({
          error: () => this.handleAuthFailure(),
        });
      } else {
        this.handleAuthFailure();
      }
    }

    return throwError(() => errorMessage);
  };

  private handleAuthFailure() {
    this.#user.set(null);
    this.stopTokenRefresh();
    this.router.navigate(['/auth/login']);
  }
}
