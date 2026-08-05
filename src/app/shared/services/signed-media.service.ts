import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of, shareReplay, catchError } from 'rxjs';
import { environment } from '../../../environments/environment';

interface SignedVariantsResponse {
  variants: Record<string, string> | null;
}

/**
 * The object a URL points at, with its signature stripped.
 *
 * Presigned URLs carry their credentials in the query string, so two URLs for
 * the same stored object are different strings whenever they were signed at
 * different times. Anything that needs to ask "is this still the same media?"
 * has to compare the path, not the URL.
 */
export const mediaIdentity = (url: string | null | undefined): string => {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.href);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0];
  }
};

/**
 * Re-signs media whose URL has stopped working.
 *
 * Attachment URLs are signed on the way out of the API with a fixed lifetime,
 * so a URL that was handed to the browser hours ago — a tab left open, a long
 * scroll back through history — can be expired by the time the element actually
 * requests the bytes. Before this, that surfaced as a permanently broken player
 * whose "Try again" button reloaded the same dead URL.
 */
@Injectable({ providedIn: 'root' })
export class SignedMediaService {
  private readonly http = inject(HttpClient);

  /**
   * In-flight and recently resolved requests, keyed by upload id.
   *
   * A conversation can show many attachments from the same upload (the message
   * bubble, the media grid, the full-screen viewer), and an expiry tends to hit
   * all of them at once. Without sharing, one expired object would produce a
   * burst of identical requests.
   */
  private readonly inFlight = new Map<string, Observable<Record<string, string> | null>>();

  refresh(uploadId: string): Observable<Record<string, string> | null> {
    if (!uploadId) return of(null);

    const existing = this.inFlight.get(uploadId);
    if (existing) return existing;

    const request = this.http
      .get<SignedVariantsResponse>(
        `${environment.apiUrl}/upload/signed-url/${uploadId}`,
      )
      .pipe(
        map((res) => res?.variants ?? null),
        catchError(() => of(null)),
        // Held so simultaneous consumers share one response. Dropped on the
        // next failure so a later expiry can be recovered from too — a cache
        // that never releases would make this a one-shot fix per session.
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    this.inFlight.set(uploadId, request);
    return request;
  }

  /** Forgets a cached response so the next failure re-requests. */
  invalidate(uploadId: string): void {
    this.inFlight.delete(uploadId);
  }
}
