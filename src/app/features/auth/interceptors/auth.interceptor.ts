import {
  HttpRequest,
  HttpEvent,
  HttpInterceptorFn,
  HttpHandlerFn,
} from '@angular/common/http';
import { toast } from 'ngx-sonner';
import { catchError, Observable, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const accessToken = localStorage.getItem('accessToken');

  if (accessToken) {
    const authRequest = request.clone({
      setHeaders: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return next(authRequest).pipe(
      catchError((err) => {
        toast.error('Something went wrong!', {
          description: err.message || err,
        });
        return throwError(() => err);
      })
    );
  }

  return next(request).pipe(
    catchError((err) => {
      toast.error('Something went wrong!', {
        description: err.message || err,
      });
      return throwError(() => err);
    })
  );
};
