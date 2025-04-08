import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
  HttpEvent,
} from '@angular/common/http';
import { AuthService } from '../services/auth.service';
import { inject } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  catchError,
  filter,
  switchMap,
  take,
  throwError,
} from 'rxjs';

let isRefreshing = false;
const refreshTokenSubject = new BehaviorSubject<string | null>(null);

export const refreshTokenInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const authService = inject(AuthService);

  if (request.url.includes('refresh-token')) {
    return next(request);
  }

  const addAuthHeader = (req: HttpRequest<any>, token: string) =>
    req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401) {
        return throwError(() => error);
      }

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        authService.logOut();
        return throwError(() => error);
      }

      if (!isRefreshing) {
        isRefreshing = true;
        refreshTokenSubject.next(null); // Reset

        return authService.refreshAccessToken().pipe(
          switchMap((tokens) => {
            isRefreshing = false;
            refreshTokenSubject.next(tokens.access_token);

            return next(addAuthHeader(request, tokens.access_token));
          }),
          catchError((refreshError) => {
            isRefreshing = false;
            authService.logOut();
            return throwError(() => refreshError);
          })
        );
      } else {
        // Wait for the new token
        return refreshTokenSubject.pipe(
          filter((token): token is string => !!token),
          take(1),
          switchMap((token) => next(addAuthHeader(request, token)))
        );
      }
    })
  );
};
