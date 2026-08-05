import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { CSRFService } from '../services/csrf.service';

const PUBLIC_AUTH_URLS = ['/auth/login', '/auth/logout'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const csrf = inject(CSRFService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // Only 401 means the credentials are no longer good. A 429 or a network
      // failure leaves the session intact, so it must fall straight through —
      // it is not a reason to attempt a refresh, let alone to sign anyone out.
      if (error.status !== 401) return throwError(() => error);

      if (PUBLIC_AUTH_URLS.some((url) => req.url.includes(url)))
        return throwError(() => error);

      if (req.url.includes('/auth/refresh')) {
        // refreshToken() has already run handleAuthFailure — which closes the
        // socket, resets state and asks the server to drop the cookies. Dropping
        // one localStorage key and navigating (what this did) left the websocket
        // open and the user object loaded.
        return throwError(() => error);
      }

      // Reuse detected — don't attempt refresh, hard logout
      if (error.error?.message?.includes('reuse')) {
        authService.handleAuthFailure();
        return throwError(() => error);
      }

      // No catchError on this: refreshToken() is the single place that decides
      // whether a failed refresh ends the session, and it only does so on a 401.
      // Signing out here as well meant a rate-limited refresh logged the user
      // out from two directions at once.
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
      );
    }),
  );
};
