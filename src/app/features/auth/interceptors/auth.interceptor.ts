import {
  HttpErrorResponse,
  HttpHeaders,
  HttpInterceptorFn,
} from '@angular/common/http';
import { AuthService } from '../services/auth.service';
import { inject } from '@angular/core';
import { catchError, EMPTY, switchMap, tap } from 'rxjs';
import { environment } from '../../../../environments/environment';

export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  const headers = new HttpHeaders().set(
    'Authorization',
    authService.accessToken ? `Bearer ${authService.accessToken}` : ''
  );

  const excludedUrls = [
    `${environment.apiUrl}/auth/signin`,
    `${environment.apiUrl}/auth/signup`,
    `${environment.apiUrl}/auth/reset-password`,
    `${environment.apiUrl}/auth/set-new-password`,
    `${environment.apiUrl}/auth/verify-email/send`,
    `${environment.apiUrl}/auth/verify-email/verify`,
  ];

  const shouldExclude = excludedUrls.some((url) => req.url === url);
  if (shouldExclude) {
    return next(req);
  }

  const modifiedReq = req.clone({
    withCredentials: true,
    headers: headers,
  });

  return next(modifiedReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        return authService.refreshAccessToken().pipe(
          switchMap(() => {
            return next(modifiedReq);
          })
        );
      }
      throw new Error('Unexpected error occured!');
    })
  );
};
