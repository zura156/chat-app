import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CSRFService } from '../services/csrf.service';
import { catchError } from 'rxjs';
import { toast } from '@spartan-ng/brain/sonner';

export const httpOptionsInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes('s3.zura156.xyz')) return next(req);

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
