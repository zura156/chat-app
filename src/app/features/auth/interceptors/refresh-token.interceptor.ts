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
      if (error.status === 401) {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          authService.logOut();
          return throwError(() => error);
        }
        return authService.refreshAccessToken().pipe(
          switchMap((tokens) => {
            const newRequest = request.clone({
              setHeaders: {
                Authorization: `Bearer ${tokens.access_token}`,
              },
            });

            return next(newRequest);
          }),
          catchError((refreshError) => {
            authService.logOut();
            return throwError(() => refreshError);
          })
        );
      }
      return throwError(() => error);
    })
  );
};
