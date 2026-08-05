import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CSRFService } from '../services/csrf.service';
import { catchError } from 'rxjs';
import { toast } from '@spartan-ng/brain/sonner';
import { environment } from '../../../../environments/environment';
import { UserStateService } from '../../user/services/user-state.service';

export const httpOptionsInterceptor: HttpInterceptorFn = (req, next) => {
  // Only our own API gets cookies and the CSRF header. Presigned storage PUTs
  // must go out untouched — extra headers break the signature and credentials
  // break CORS. (This used to test for one hardcoded prod hostname.)
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  // Both resolved here, synchronously: `inject()` is only legal in an injection
  // context, and the catchError callback below runs long after this function
  // has returned.
  const csrf = inject(CSRFService);
  const userState = inject(UserStateService);
  const csrfToken = csrf.getTokenFromCookie();

  const authReq = req.clone({
    withCredentials: true,
    ...(csrfToken ? { setHeaders: { 'X-CSRF-TOKEN': csrfToken } } : {}),
  });

  return next(authReq).pipe(
    catchError((error) => {
      // The session is untouched by a rate limit — this is a "wait", not a
      // sign-out, and every limiter now returns how long to wait for.
      if (error.status === 429) {
        toast.warning(
          error.error?.message ?? 'Too many requests. Please try again later.',
        );
      }

      // The messaging surface is gated on a verified address. Recording it
      // here — where the refusal actually arrives — is what lets the UI show a
      // real explanation instead of an empty screen and a toast.
      if (error.status === 403 && error.error?.code === 'EMAIL_NOT_VERIFIED') {
        userState.flagEmailVerificationRequired();
      }

      throw error;
    }),
  );
};
