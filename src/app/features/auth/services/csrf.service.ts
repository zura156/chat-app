import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CSRFService {
  private readonly http = inject(HttpClient);

  private priming$?: Observable<string | null>;

  getTokenFromCookie(): string | null {
    const match = document.cookie.match(/(?:^|;\s*)csrfToken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * Guarantees a CSRF token exists before a mutating request goes out.
   *
   * The token used to be minted only by a successful login, which meant login
   * itself — and register, and forgot-password — had nothing to submit and so
   * could not be CSRF-protected at all. The server now hands one out on any
   * safe request; this is the client asking for one up front.
   *
   * De-duplicated: several unauthenticated screens can call this at once and
   * only one request should go out.
   */
  ensureToken(): Observable<string | null> {
    const existing = this.getTokenFromCookie();
    if (existing) return of(existing);

    this.priming$ ??= this.http
      .get<{ csrfToken: string }>(`${environment.apiUrl}/auth/csrf`, {
        withCredentials: true,
      })
      .pipe(
        map((response) => response.csrfToken ?? this.getTokenFromCookie()),
        tap({
          // Cleared either way, so a later call can retry rather than replay a
          // failure forever.
          finalize: () => (this.priming$ = undefined),
        }),
        shareReplay(1),
      );

    return this.priming$;
  }
}
