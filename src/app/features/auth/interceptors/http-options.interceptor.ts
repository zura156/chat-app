import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CSRFService } from '../services/csrf.service';

export const httpOptionsInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes('s3.zura156.xyz')) return next(req);

  const csrf = inject(CSRFService);
  const csrfToken = csrf.getTokenFromCookie();

  const authReq = req.clone({
    withCredentials: true,
    ...(csrfToken ? { setHeaders: { 'X-CSRF-TOKEN': csrfToken } } : {}),
  });

  return next(authReq);
};
