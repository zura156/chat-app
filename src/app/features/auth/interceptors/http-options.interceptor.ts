import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CSRFService } from '../services/csrf.service';
import { catchError } from 'rxjs';
import { toast } from '@spartan-ng/brain/sonner';
import { environment } from '../../../../environments/environment';
import { UserStateService } from '../../user/services/user-state.service';

export const httpOptionsInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const csrf = inject(CSRFService);
  const userState = inject(UserStateService);
  const csrfToken = csrf.getTokenFromCookie();

  const authReq = req.clone({
    withCredentials: true,
    ...(csrfToken ? { setHeaders: { 'X-CSRF-TOKEN': csrfToken } } : {}),
  });

  return next(authReq).pipe(
    catchError((error) => {
      if (error.status === 429) {
        toast.warning(
          error.error?.message ?? 'Too many requests. Please try again later.',
        );
      }

      if (error.status === 403 && error.error?.code === 'EMAIL_NOT_VERIFIED') {
        userState.flagEmailVerificationRequired();
      }

      throw error;
    }),
  );
};
