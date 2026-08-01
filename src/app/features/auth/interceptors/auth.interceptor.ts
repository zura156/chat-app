import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { CSRFService } from '../services/csrf.service';

const PUBLIC_AUTH_URLS = ['/auth/login', '/auth/logout'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const csrf = inject(CSRFService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401) return throwError(() => error);

      if (PUBLIC_AUTH_URLS.some((url) => req.url.includes(url)))
        return throwError(() => error);

      if (req.url.includes('/auth/refresh')) {
        localStorage.removeItem('isAuthenticated');
        router.navigate(['/auth/login']);
        return throwError(() => error);
      }

      // Reuse detected — don't attempt refresh, hard logout
      if (error.error?.message?.includes('reuse')) {
        authService.handleAuthFailure();
        return throwError(() => error);
      }

      return authService.refreshToken().pipe(
        switchMap(() => {
          // /auth/refresh rotates the csrfToken cookie. `req` was stamped with
          // the previous value by httpOptionsInterceptor (which does not run
          // again on replay), so re-read the cookie or the retry 403s.
          const csrfToken = csrf.getTokenFromCookie();
          return next(
            csrfToken
              ? req.clone({ setHeaders: { 'X-CSRF-TOKEN': csrfToken } })
              : req,
          );
        }),
        catchError((refreshError) => {
          authService.handleAuthFailure();
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
