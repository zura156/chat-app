import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, tap } from 'rxjs/operators';
import { throwError, BehaviorSubject } from 'rxjs';
import { UserModel } from '../models/user.model';
import { AuthResponseI } from '../interfaces/auth-response.interface';
import { environment } from '../../../../environments/environment';
import { AuthRequestI } from '../interfaces/auth-request.interface';

@Injectable({ providedIn: 'root' })
export class AuthService {
  user = new BehaviorSubject<UserModel | null>(null);
  private tokenExpirationTimer: any;

  SIGNUP_URL: string =
    'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' +
    environment.firebaseAPIKey;
  LOGIN_URL: string =
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' +
    environment.firebaseAPIKey;

  constructor(private http: HttpClient, private router: Router) {
    const userData = localStorage.getItem('userData');
    if (userData) {
      const parsedData: {
        email: string;
        id: string;
        _token: string;
        _tokenExpirationDate: string;
      } = JSON.parse(userData);

      const loadedUser = new UserModel(
        parsedData.email,
        parsedData.id,
        parsedData._token,
        new Date(parsedData._tokenExpirationDate)
      );

      if (loadedUser.token) {
        this.user.next(loadedUser);
        this.autoLogout(
          new Date(parsedData._tokenExpirationDate).getTime() - Date.now()
        );
      } else {
        localStorage.removeItem('userData');
      }
    }
  }

  signup(credentials: AuthRequestI) {
    return this.http
      .post<AuthResponseI>(this.SIGNUP_URL, {
        email: credentials.email,
        password: credentials.password,
        returnSecureToken: true,
      })
      .pipe(
        catchError(this.handleError),
        tap((resData) => {
          this.handleAuthentication(
            resData.email,
            resData.localId,
            resData.idToken,
            +resData.expiresIn
          );
        })
      );
  }

  login(credentials: AuthRequestI) {
    return this.http
      .post<AuthResponseI>(this.LOGIN_URL, {
        email: credentials.email,
        password: credentials.password,
        returnSecureToken: true,
      })
      .pipe(
        catchError(this.handleError),
        tap((resData) => {
          this.handleAuthentication(
            resData.email,
            resData.localId,
            resData.idToken,
            +resData.expiresIn
          );
        })
      );
  }

  autoLogin() {
    const storageData = localStorage.getItem('userData');
    if (storageData) {
      const userData: {
        email: string;
        id: string;
        _token: string;
        _tokenExpirationDate: string;
      } = JSON.parse(storageData);

      const loadedUser = new UserModel(
        userData.email,
        userData.id,
        userData._token,
        new Date(userData._tokenExpirationDate)
      );

      if (loadedUser.token) {
        this.user.next(loadedUser);
        const expirationDuration =
          new Date(userData._tokenExpirationDate).getTime() -
          new Date().getTime();
        this.autoLogout(expirationDuration);
      }
    } else {
      return;
    }
  }

  logout() {
    this.user.next(null);
    this.router.navigate(['/signin']);
    localStorage.removeItem('userData');
    if (this.tokenExpirationTimer) {
      clearTimeout(this.tokenExpirationTimer);
    }
    this.tokenExpirationTimer = null;
  }

  autoLogout(expirationDuration: number) {
    this.tokenExpirationTimer = setTimeout(() => {
      this.logout();
    }, expirationDuration);
  }

  private handleAuthentication(
    email: string,
    userId: string,
    token: string,
    expiresIn: number
  ) {
    const expirationDate = new Date(new Date().getTime() + expiresIn * 1000);
    const user = new UserModel(email, userId, token, expirationDate);
    this.user.next(user);
    this.autoLogout(expiresIn * 1000);
    localStorage.setItem('userData', JSON.stringify(user));
  }

  private handleError(errorRes: HttpErrorResponse) {
    let errorMessage = 'An unknown error occurred!';
    if (!errorRes.error || !errorRes.error.error) {
      return throwError(errorMessage);
    }
    switch (errorRes.error.error.message) {
      case 'EMAIL_EXISTS':
        errorMessage = 'This email exists already';
        break;
    }
    return throwError(errorMessage);
  }
}
