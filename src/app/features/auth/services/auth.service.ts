import { inject, Injectable, Injector } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { BehaviorSubject, catchError, Observable, tap, throwError } from 'rxjs';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { LoginResponseI } from '../interfaces/login-response.interface';
import { RegisterResponseI } from '../interfaces/register-response.interface';
import { RefreshTokenResponseI } from '../interfaces/refresh-token-response.interface';
import { RegisterCredentialsI } from '../interfaces/register-credentials.interface';
import { LoginCredentialsI } from '../interfaces/login-credentials.interface';
import { NavigationStart, Router } from '@angular/router';
import { WebSocketService } from '../../messages/services/web-socket.service';
import { UserService } from '../../user/services/user.service';
import { UserStatusMessage } from '../../messages/interfaces/web-socket-message.interface';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private injector = inject(Injector);

  private _userService: UserService | null = null;

  private get userService(): UserService {
    if (!this._userService) {
      this._userService = this.injector.get(UserService);
    }
    return this._userService;
  }

  /*
   * Dependency injections.
   */

  http = inject(HttpClient);
  router = inject(Router);
  webSocketService = inject(WebSocketService);

  /*
   * API Urls.
   */
  private readonly _LOGIN_URL = `${environment.apiUrl}/auth/login`;
  private readonly _REGISTER_URL = `${environment.apiUrl}/auth/register`;
  private readonly _REFRESH_TOKEN_URL = `${environment.apiUrl}/auth/refresh-token`;

  /*
   * states for auto-logout
   */

  private readonly LAST_ACTIVE_TIME_KEY = 'lastActiveTime';
  private readonly AUTO_LOGOUT_TIME = Math.floor(3600 * 1000);

  /*
   * States determining user authorization
   */
  signedIn$ = new BehaviorSubject<boolean>(
    !!localStorage.getItem('accessToken')
  );

  accessToken$ = new BehaviorSubject<string | null>(
    localStorage.getItem('accessToken')
  );
  refreshToken$ = new BehaviorSubject<string | null>(
    localStorage.getItem('refreshToken')
  );

  /*
   * Setting state for authorization and .
   */
  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.setLastActiveTime();
      }
    });

    if (!this.accessToken) this.logOut();

    this.signedIn$.next(!!this.accessToken);
    this.setupUnloadListener();
  }
  ngOnDestroy(): void {
    document.removeEventListener('beforeunload', this.handleBeforeUnload);
  }

  /*
   * Get the current user's data needed for authorization
   */

  get accessToken(): string | null {
    const accessToken = localStorage.getItem('accessToken');
    return accessToken;
  }

  get refreshToken(): string | null {
    const refreshToken = localStorage.getItem('refreshToken');
    return refreshToken;
  }

  /*
  ? Small security feature.
  * it checks before unload, if user info is deleted.
  * if info is deleted from local storage, it will be reloaded.
  */
  private setupUnloadListener(): void {
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
  }

  // private handleBeforeUnload(): void {
  handleBeforeUnload(): void {
    const { accessToken, refreshToken } = this;
    if (
      !accessToken ||
      !refreshToken ||
      this.refreshToken$.value !== refreshToken ||
      this.accessToken$.value !== accessToken
    ) {
      this.handleStorage();
    }

    const currentUser = this.userService.currentUser();

    if (currentUser) {
      const { _id } = currentUser;

      const data: UserStatusMessage = {
        type: 'user-status',
        userId: _id,
        status: 'offline',
        last_seen: new Date().toISOString(),
      };
      this.webSocketService.sendMessage(data);
    }
  }

  /*
   * Saving user info to local storage.
   */
  private handleStorage() {
    const { accessToken$, refreshToken$ } = this;

    if (accessToken$.value && refreshToken$.value) {
      // const tokenData: TokenDataI = JSON.parse(
      //   atob(accessToken$.value.split('.')[1])
      // );

      this.signedIn$.next(true);

      localStorage.setItem('accessToken', accessToken$.value);
      localStorage.setItem('refreshToken', refreshToken$.value);
    }
  }

  /*
   * Clearing local storage.
   */
  clearMemory() {
    this.signedIn$.next(false);
    this.accessToken$.next(null);
    sessionStorage.clear();
    localStorage.clear();
  }

  /*
   * Function to set last active time on application.
   */
  setLastActiveTime(): void {
    const currentTime = Date.now();
    localStorage.setItem(this.LAST_ACTIVE_TIME_KEY, currentTime.toString());
  }

  /*
   * Registering new users
   */
  register(credentials: RegisterCredentialsI): Observable<RegisterResponseI> {
    return this.http
      .post<RegisterResponseI>(this._REGISTER_URL, credentials)
      .pipe(catchError(this.handleError));
  }

  /*
   *user authentication
   */
  login(credentials: LoginCredentialsI): Observable<LoginResponseI> {
    return this.http.post<LoginResponseI>(this._LOGIN_URL, credentials).pipe(
      tap((res) => {
        const tokens = {
          access_token: res.access_token,
          refresh_token: res.refresh_token,
        };
        this.handleAuthentication(tokens);
      }),
      catchError(this.handleError)
    );
  }

  /*
   * Refresh token request
   */

  refreshAccessToken(): Observable<RefreshTokenResponseI> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
      'refresh-token': this.refreshToken ?? 'UNDEFINED',
    });

    return this.http
      .post<RefreshTokenResponseI>(this._REFRESH_TOKEN_URL, {}, { headers })
      .pipe(
        tap((res) => {
          if (res.access_token && res.refresh_token) {
            this.accessToken$.next(res.access_token);
            this.refreshToken$.next(res.refresh_token);
            localStorage.setItem('accessToken', res.access_token);
            localStorage.setItem('refreshToken', res.refresh_token);
          } else {
            this.clearMemory();
          }
        }),
        catchError(this.handleError)
      );
  }

  /*
   * Loggin user out of session.
   */
  logOut(): void {
    this.clearMemory();
  }

  /*
   * Function to handle error.
   */
  private handleError(errorRes: HttpErrorResponse) {
    let errorMessage = 'An unknown error occurred!';

    if (errorRes.error && errorRes.error.message) {
      errorMessage = errorRes.error.message;
    } else if (errorRes.error && typeof errorRes.error === 'string') {
      errorMessage = errorRes.error;
    }

    return throwError(() => new Error(errorMessage));
  }

  private handleAuthentication(token: {
    access_token: string;
    refresh_token: string;
  }): void {
    this.accessToken$.next(token.access_token);
    localStorage.setItem('accessToken', token.access_token);
    this.refreshToken$.next(token.refresh_token);
    localStorage.setItem('refreshToken', token.refresh_token);
    this.signedIn$.next(true);

    this.handleStorage();
  }
}
