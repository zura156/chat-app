import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import {
  catchError,
  Observable,
  tap,
  throwError,
  switchMap,
  retry,
} from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RegisterCredentialsI } from '../interfaces/register-credentials.interface';
import { LoginCredentialsI } from '../interfaces/login-credentials.interface';
import { WebSocketService } from '../../messages/services/web-socket.service';
import { UserStatusMessage } from '../../messages/interfaces/web-socket-message.interface';
import { UserStateService } from '../../user/services/user-state.service';
import { MessageResponseI } from '../../../shared/interfaces/message-response.interface';
import { ResetPasswordI } from '../interfaces/reset-password.interface';
import { AuthResponseI } from '../interfaces/auth-response.interface';
import { UserI } from '../../user/interfaces/user.interface';
import { CSRFTokenI } from '../interfaces/csrf-token.interface';
import { UserService } from '../../user/services/user.service';
import { CSRFService } from './csrf.service';
import { Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { UnlockAccountI } from '../interfaces/unlock-account.interface';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  /*
   * Dependency injections.
   */

  private http = inject(HttpClient);
  private router = inject(Router);
  private csrfService = inject(CSRFService);
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
  private readonly _UNLOCK_ACCOUNT_URL = `${environment.apiUrl}/auth/unlock-account`;
  private readonly _VERIFY_EMAIL_URL = `${environment.apiUrl}/auth/verify-email`;
  private readonly _REFRESH_TOKEN_URL = `${environment.apiUrl}/auth/refresh`;

  // private readonly LAST_ACTIVE_TIME_KEY = 'lastActiveTime';
  // private readonly AUTO_LOGOUT_TIME = Math.floor(3600 * 1000);
  private readonly IS_AUTHENTICATED_KEY = 'isAuthenticated';

  /*
   * Signals for reactive state management
   */
  #loading = signal<boolean>(false);
  #error = signal<string | null>(null);

  public readonly user = this.userStateService.currentUser;
  public readonly loading = this.#loading.asReadonly();
  public readonly error = this.#error.asReadonly();
  public readonly isAuthenticated = signal(
    localStorage.getItem(this.IS_AUTHENTICATED_KEY) === 'true',
  );
  // public readonly isAdmin = computed(() => this.#user()?.role === 'admin');
  public readonly isEmailVerified = computed(
    () => this.user()?.is_email_verified ?? false,
  );

  /*
   * Setting state for authorization and .
   */
  init(): void {
    if (this.isAuthenticated()) {
      this.initializeAuth().subscribe();
      this.setupUnloadListener();
    }
  }

  private initializeAuth() {
    return this.csrfService.getCSRFToken().pipe(
      switchMap(() =>
        this.userService.getCurrentUser().pipe(
          tap((res) => {
            this.userStateService.setCurrentUser(res);
            localStorage.setItem(this.IS_AUTHENTICATED_KEY, 'true');
            this.isAuthenticated.set(true);

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
          }),
        ),
      ),
      catchError(this.handleError),
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
    const currentUser = this.user();

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
      this.isAuthenticated.set(true);
    }
  }

  /*
   * Registering new users
   */
  register(credentials: RegisterCredentialsI): Observable<AuthResponseI> {
    this.#loading.set(true);
    this.#error.set(null);

    return this.http.post<AuthResponseI>(this._REGISTER_URL, credentials).pipe(
      tap(() => this.#loading.set(false)),
      catchError(this.handleError),
    );
  }

  /*
   * User authentication
   */
  login(credentials: LoginCredentialsI): Observable<UserI> {
    this.#loading.set(true);
    this.#error.set(null);

    return this.http.post<AuthResponseI>(this._LOGIN_URL, credentials).pipe(
      switchMap(({ user }) => {
        this.#loading.set(false);
        if (user) {
          this.userStateService.setCurrentUser(user);
        }
        localStorage.setItem(this.IS_AUTHENTICATED_KEY, 'true');
        this.isAuthenticated.set(true);

        return this.initializeAuth().pipe(
          tap(() => this.router.navigateByUrl('/messages')),
        );
      }),
      catchError(this.handleError),
    );
  }

  /*
   * Verify email (link approach)
   */
  verifyEmail(token: string): Observable<AuthResponseI> {
    return this.http
      .post<AuthResponseI>(this._VERIFY_EMAIL_URL, { token })
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

  /*
   * Set new password (link approach)
   */
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

  /*
   * Refresh token management
   */
  refreshToken(): Observable<CSRFTokenI> {
    return this.http.post<AuthResponseI>(this._REFRESH_TOKEN_URL, {}).pipe(
      retry(1),
      catchError((error) => {
        this.handleAuthFailure();
        return this.handleError(error);
      }),
      switchMap(() => this.csrfService.getCSRFToken()),
    );
  }

  /*
   * Loggin user out of session.
   */
  logOut(): Observable<AuthResponseI> {
    this.#loading.set(true);

    return this.http.post<AuthResponseI>(this._LOGOUT_URL, {}).pipe(
      tap(() => {
        this.userStateService.setCurrentUser(null);
        localStorage.clear();
        this.isAuthenticated.set(false);
        this.csrfService.clearCSRFToken();
        this.#loading.set(false);

        this.router.navigateByUrl('/auth/login');
      }),
      catchError(this.handleError.bind(this)),
    );
  }

  /*
   * Function to handle error.
   */
  private handleError = (error: HttpErrorResponse) => {
    this.#loading.set(false);

    let errorMessage = 'An unknown error occurred';

    if (error.error?.message) {
      errorMessage = error.error.message;
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

    // toast.error('Something went wrong.', {
    //   description: errorMessage,
    // });

    return throwError(() => errorMessage);
  };

  private handleAuthFailure() {
    this.userStateService.setCurrentUser(null);
    this.router.navigateByUrl('/auth/login');
  }
}
