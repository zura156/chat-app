import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CSRFService } from '../services/csrf.service';
import { catchError, switchMap } from 'rxjs';
import { toast } from '@spartan-ng/brain/sonner';
import { environment } from '../../../../environments/environment';
import { UserStateService } from '../../user/services/user-state.service';

/** Marks the one replay a CSRF failure is allowed, so it cannot loop. */
const RETRY_HEADER = 'X-CSRF-Retry';

export const httpOptionsInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const csrf = inject(CSRFService);
  const userState = inject(UserStateService);
  const csrfToken = csrf.getTokenFromCookie();
  const isRetry = req.headers.has(RETRY_HEADER);

  const authReq = req.clone({
    withCredentials: true,
    ...(csrfToken ? { setHeaders: { 'X-CSRF-TOKEN': csrfToken } } : {}),
  });

  return next(authReq).pipe(
    catchError((error) => {
      /*
       * A CSRF token that has expired is recoverable, and nothing recovered it.
       *
       * The cookie is only re-issued on safe methods, and the client asks for
       * one exactly once, at boot. So a tab left open long enough for the
       * cookie to lapse got 403 `code: 'CSRF'` on every write, for the rest of
       * its life, with no path back but a reload. One re-fetch and one replay
       * settles it; the retry carries the fresh token, and it is not itself
       * retried.
       */
      if (error.status === 403 && error.error?.code === 'CSRF' && !isRetry) {
        return csrf.ensureToken().pipe(
          switchMap((token) =>
            next(
              req.clone({
                withCredentials: true,
                setHeaders: {
                  ...(token ? { 'X-CSRF-TOKEN': token } : {}),
                  [RETRY_HEADER]: '1',
                },
              }),
            ),
          ),
        );
      }

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
