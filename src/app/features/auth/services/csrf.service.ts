import { inject, Injectable, signal } from '@angular/core';
import { CSRFTokenI } from '../interfaces/csrf-token.interface';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class CSRFService {
  private readonly _CSRF_TOKEN_URL = `${environment.apiUrl}/auth/csrf-token`;
  private http = inject(HttpClient);

  #csrfToken = signal<string | null>(null);
  csrfToken = this.#csrfToken.asReadonly();

  getCSRFToken(): Observable<CSRFTokenI> {
    return this.http.get<CSRFTokenI>(this._CSRF_TOKEN_URL).pipe(
      tap(({ csrfToken }) => {
        if (csrfToken) {
          this.#csrfToken.set(csrfToken);
        }
      }),
      catchError(this.handleError)
    );
  }

  clearCSRFToken(): void {
    this.#csrfToken.set(null);
  }

  /*
   * Function to handle error.
   */
  private handleError = (error: HttpErrorResponse) => {
    let errorMessage = 'An unknown error occurred';

    if (error.error?.error) {
      errorMessage = error.error.error;
    } else if (error.error?.errors?.length > 0) {
      errorMessage = error.error.errors.map((e: any) => e.msg).join(', ');
    } else if (error.message) {
      errorMessage = error.message;
    }

    return throwError(() => errorMessage);
  };
}
