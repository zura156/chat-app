import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CSRFService } from '../services/csrf.service';

export const httpOptionsInterceptor: HttpInterceptorFn = (req, next) => {
  const csrf = inject(CSRFService);
  const csrfToken = csrf.getTokenFromCookie();

  const authReq = req.clone({
    withCredentials: true,
    ...(csrfToken ? { setHeaders: { 'X-CSRF-TOKEN': csrfToken } } : {}),
  });

  return next(authReq);
};
