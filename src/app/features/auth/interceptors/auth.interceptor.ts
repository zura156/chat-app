import {
  HttpRequest,
  HttpEvent,
  HttpInterceptorFn,
  HttpHandlerFn,
  HttpErrorResponse,
  HttpClient,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, Observable, switchMap, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Router } from '@angular/router';

export const authInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const http = inject(HttpClient);
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

        // Attempt token refresh directly in interceptor
        const refreshUrl = `${environment.apiUrl}/auth/refresh`;

        return http.post(refreshUrl, {}, { withCredentials: true }).pipe(
          switchMap(() => {
            // Retry the original request after successful refresh
            return next(request);
          }),
          catchError((refreshError) => {
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
