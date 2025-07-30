import {
  HttpRequest,
  HttpEvent,
  HttpInterceptorFn,
  HttpHandlerFn,
  HttpHeaders,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CSRFService } from '../services/csrf.service';

export const httpOptionsInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const csrf = inject(CSRFService);
  let headers = new HttpHeaders();

  const csrfToken = csrf.csrfToken();

  if (csrfToken) {
    headers = headers.set('X-CSRF-Token', csrfToken);
  }

  const authRequest = request.clone({
    headers,
    withCredentials: true,
  });

  return next(authRequest);
};
