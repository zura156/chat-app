import { inject, Injectable } from '@angular/core';
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
import { TokenDataI } from '../interfaces/token-data.interface';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  /*
   * Dependency injections.
   */

  http = inject(HttpClient);

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
  private handleBeforeUnload(): void {
    const { accessToken, refreshToken } = this;
    if (
      !accessToken ||
      !refreshToken ||
      this.refreshToken$.value !== refreshToken ||
      this.accessToken$.value !== accessToken
    ) {
      this.handleStorage();
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
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
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
        tap((res: any) => {
          const newToken = res.token;

          if (newToken) {
            this.accessToken$.next(newToken);
            localStorage.setItem('accessToken', newToken);
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
    accessToken: string;
    refreshToken: string;
  }): void {
    this.accessToken$.next(token.accessToken);
    localStorage.setItem('accessToken', token.accessToken);
    this.refreshToken$.next(token.refreshToken);
    localStorage.setItem('refreshToken', token.refreshToken);
    this.signedIn$.next(true);

    this.handleStorage();
  }
}
