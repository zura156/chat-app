import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';

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

  /*
  ? Small security feature.
  * it checks before unload, if user info is deleted.
  * if info is deleted from local storage, it will be reloaded.
  */
  private setupUnloadListener(): void {
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
  }
  private handleBeforeUnload(): void {
    const { accessToken } = this;
    if (!accessToken || this.accessToken$.value !== accessToken) {
      this.handleStorage();
    }
  }

  /*
   * Saving user info to local storage.
   */
  private handleStorage() {
    const { accessToken$} = this;

    if (accessToken$.value) {
      const tokenData: any = JSON.parse(atob(accessToken$.value.split('.')[1]));
      console.log(tokenData);

      this.signedIn$.next(true);

      localStorage.setItem('accessToken', accessToken$.value);
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
  register(credentials: { username: string; email: string; password: string }) {
    return this.http.post(this._REGISTER_URL, credentials);
  }

  /*
   *user authentication
   */
  login(credentials: {
    username?: string;
    email?: string;
    password: string;
  }): Observable<any> {
    return this.http.post(this._LOGIN_URL, credentials);
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
}
