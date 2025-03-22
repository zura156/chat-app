import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { AuthService } from '../services/auth.service';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

export const refreshTokenInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const authService = inject(AuthService);

  if (request.url.includes('refresh-token')) {
    return next(request);
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 41) {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          authService.logOut();
          return throwError(() => error);
        }
        return authService.refreshAccessToken(refreshToken).pipe(
          switchMap((tokens) => {
            // Save new tokens
            localStorage.setItem('accessToken', tokens.accessToken);
            localStorage.setItem('refreshToken', tokens.refreshToken);

            // Clone the original request and replace the old token with new one
            const newRequest = request.clone({
              setHeaders: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            });

            // Retry the request with the new token
            return next(newRequest);
          }),
          catchError((refreshError) => {
            // If refresh fails, logout the user
            authService.logout();
            return throwError(() => refreshError);
          })
        );
      }
    })
  );
};
