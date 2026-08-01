import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CSRFService } from '../services/csrf.service';
import { catchError } from 'rxjs';
import { toast } from '@spartan-ng/brain/sonner';
import { environment } from '../../../../environments/environment';

export const httpOptionsInterceptor: HttpInterceptorFn = (req, next) => {
  // Only our own API gets cookies and the CSRF header. Presigned storage PUTs
  // must go out untouched — extra headers break the signature and credentials
  // break CORS. (This used to test for one hardcoded prod hostname.)
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const csrf = inject(CSRFService);
  const csrfToken = csrf.getTokenFromCookie();

  const authReq = req.clone({
    withCredentials: true,
    ...(csrfToken ? { setHeaders: { 'X-CSRF-TOKEN': csrfToken } } : {}),
  });

  return next(authReq).pipe(
    catchError((error) => {
      if (error.status === 429) {
        toast.warning('Too many requests. Please try again later.');
      }
      throw error;
    }),
  );
};
