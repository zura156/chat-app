import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401) return throwError(() => error);
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
        switchMap(() => next(req)),
        catchError((refreshError) => {
          authService.handleAuthFailure();
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
