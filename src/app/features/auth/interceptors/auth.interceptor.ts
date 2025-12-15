import {
  HttpRequest,
  HttpEvent,
  HttpInterceptorFn,
  HttpHandlerFn,
  HttpErrorResponse,
} from '@angular/common/http';
import { inject, Injector } from '@angular/core';
import { catchError, Observable, switchMap, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (
        error.status === 401 &&
        localStorage.getItem('isAuthenticated') === 'true'
      ) {
        // Don't intercept refresh token requests to prevent infinite loop
        if (request.url.includes('/auth/refresh')) {
          // If refresh token request fails, redirect to login
          localStorage.removeItem('isAuthenticated');
          router.navigate(['/auth/login']);
          return throwError(() => error);
        }

        return authService.refreshToken().pipe(
          switchMap(() => {
            // Retry the original request after successful refresh
            return next(request);
          }),
          catchError((error) => {
            // If refresh fails, redirect to login
            localStorage.removeItem('isAuthenticated');
            router.navigate(['/auth/login']);
            return throwError(() => error);
          })
        );
      }

      return throwError(() => error);
    })
  );
};
