import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpResponse,
} from '@angular/common/http';
import { of, throwError } from 'rxjs';

/**
 * Answers `GET /auth/oidc/providers` for a spec, immediately.
 *
 * Not HttpTestingController: an HttpClient request in flight keeps the app
 * unstable, so `whenStable()` — and RouterTestingHarness, which awaits it —
 * never resolves until something flushes it, and a spec that only wanted the
 * login form hangs for its whole timeout. Answering inside the interceptor
 * chain settles it before stability is ever awaited.
 */
export const answerOidcProviders =
  (providers: unknown[] | 'error'): HttpInterceptorFn =>
  (req, next) => {
    if (!req.url.endsWith('/auth/oidc/providers')) return next(req);
    return providers === 'error'
      ? throwError(
          () => new HttpErrorResponse({ status: 503, url: req.url }),
        )
      : of(new HttpResponse({ status: 200, body: { providers } }));
  };
