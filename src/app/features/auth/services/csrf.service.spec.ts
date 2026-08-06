import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSRFService } from './csrf.service';
import { environment } from '../../../../environments/environment';

/*
 * The client half of CSRF protection.
 *
 * The token used to be minted only by a successful login, which left login,
 * register and forgot-password with nothing to send — the three unauthenticated
 * forms, and the ones most worth protecting. The server now hands one out on
 * any safe request and this asks for it up front.
 *
 * Two things here are easy to get wrong and invisible when wrong: the cookie
 * regex (a loose one matches a *different* cookie and sends a token the server
 * rejects) and the de-duplication (several unauthenticated screens prime at
 * once, and the last response wins the cookie race).
 */

const CSRF_URL = `${environment.apiUrl}/auth/csrf`;

/** jsdom keeps cookies for the document's lifetime; this is the only way out. */
const clearCookies = () => {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
};

describe('CSRFService', () => {
  let service: CSRFService;
  let http: HttpTestingController;

  beforeEach(() => {
    clearCookies();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(CSRFService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    clearCookies();
    vi.restoreAllMocks();
  });

  describe('reading the cookie', () => {
    it('returns null when there is no token', () => {
      expect(service.getTokenFromCookie()).toBeNull();
    });

    it('reads the token when it is the only cookie', () => {
      document.cookie = 'csrfToken=abc123; path=/';
      expect(service.getTokenFromCookie()).toBe('abc123');
    });

    it('reads the token from the middle of the cookie string', () => {
      document.cookie = 'theme=dark; path=/';
      document.cookie = 'csrfToken=abc123; path=/';
      document.cookie = 'locale=en; path=/';

      expect(service.getTokenFromCookie()).toBe('abc123');
    });

    it('does not match a cookie whose name merely ends in csrfToken', () => {
      /*
       * The anchor (`^` or `; `) is the whole defence here. Without it,
       * `_csrfToken` or `oldcsrfToken` matches and the app cheerfully sends
       * that value as the header — every mutating request then 403s, with
       * nothing in the UI to explain why.
       */
      document.cookie = 'xcsrfToken=wrong; path=/';
      document.cookie = '_csrfToken=alsowrong; path=/';

      expect(service.getTokenFromCookie()).toBeNull();
    });

    it('still finds the real token alongside a lookalike', () => {
      document.cookie = 'xcsrfToken=wrong; path=/';
      document.cookie = 'csrfToken=right; path=/';

      expect(service.getTokenFromCookie()).toBe('right');
    });

    it('decodes a percent-encoded token', () => {
      // The server sets it URL-encoded; sending the raw form back fails the
      // comparison for exactly the tokens containing a `+` or `/`.
      document.cookie = `csrfToken=${encodeURIComponent('a+b/c=')}; path=/`;
      expect(service.getTokenFromCookie()).toBe('a+b/c=');
    });

    it('reads the current value after the cookie is rotated', () => {
      // /auth/refresh rotates it mid-session; a cached read would replay the
      // superseded token on the retried request.
      document.cookie = 'csrfToken=first; path=/';
      expect(service.getTokenFromCookie()).toBe('first');

      document.cookie = 'csrfToken=second; path=/';
      expect(service.getTokenFromCookie()).toBe('second');
    });
  });

  describe('ensureToken', () => {
    it('does not call the server when a token already exists', () => {
      document.cookie = 'csrfToken=existing; path=/';

      let emitted: string | null = 'unset';
      service.ensureToken().subscribe((token) => (emitted = token));

      expect(emitted).toBe('existing');
      http.expectNone(CSRF_URL);
    });

    it('asks the server when there is no token', () => {
      let emitted: string | null = null;
      service.ensureToken().subscribe((token) => (emitted = token));

      http.expectOne(CSRF_URL).flush({ csrfToken: 'minted' });
      expect(emitted).toBe('minted');
    });

    it('sends credentials, so the server can set the cookie', () => {
      // Without this the response's Set-Cookie is discarded and every priming
      // call re-requests forever.
      service.ensureToken().subscribe();

      expect(http.expectOne(CSRF_URL).request.withCredentials).toBe(true);
      http.expectOne; // no-op: request already matched above
    });

    it('issues one request when several screens prime at once', () => {
      /*
       * The de-duplication. Login, register and forgot-password can each call
       * this on init; three requests would each rotate the cookie and the
       * first two headers would be stale by the time a form was submitted.
       */
      const seen: (string | null)[] = [];
      service.ensureToken().subscribe((t) => seen.push(t));
      service.ensureToken().subscribe((t) => seen.push(t));
      service.ensureToken().subscribe((t) => seen.push(t));

      http.expectOne(CSRF_URL).flush({ csrfToken: 'minted' });

      expect(seen).toEqual(['minted', 'minted', 'minted']);
    });

    it('falls back to the cookie when the body carries no token', () => {
      // The token's real home is the cookie; the body is a convenience. A
      // deployment that stops echoing it must not break priming.
      service.ensureToken().subscribe();

      document.cookie = 'csrfToken=from-cookie; path=/';
      const request = http.expectOne(CSRF_URL);

      let emitted: string | null = null;
      service.ensureToken().subscribe((token) => (emitted = token));
      request.flush({});

      expect(emitted).toBe('from-cookie');
    });

    it('serves the cookie directly once one has been minted', () => {
      service.ensureToken().subscribe();
      const request = http.expectOne(CSRF_URL);
      document.cookie = 'csrfToken=minted; path=/';
      request.flush({ csrfToken: 'minted' });

      let emitted: string | null = null;
      service.ensureToken().subscribe((token) => (emitted = token));

      expect(emitted).toBe('minted');
      http.expectNone(CSRF_URL);
    });

    it('re-requests after a failure rather than replaying it forever', () => {
      /*
       * `shareReplay` caches the *terminal* notification too, so without the
       * finalize that clears the in-flight observable, one failed priming
       * request would hand the same error to every later caller for the rest
       * of the session — the forms would never recover, even once the network
       * came back.
       */
      const errors: unknown[] = [];
      service.ensureToken().subscribe({ error: (e) => errors.push(e) });
      http.expectOne(CSRF_URL).error(new ProgressEvent('network'));
      expect(errors).toHaveLength(1);

      let emitted: string | null = null;
      service.ensureToken().subscribe({ next: (t) => (emitted = t) });
      http.expectOne(CSRF_URL).flush({ csrfToken: 'second-try' });

      expect(emitted).toBe('second-try');
    });

    it('propagates the failure rather than emitting null', () => {
      // The caller decides what a missing token means; swallowing it here
      // would let a form submit knowing it will 403.
      let failed = false;
      service.ensureToken().subscribe({ error: () => (failed = true) });
      http.expectOne(CSRF_URL).error(new ProgressEvent('network'), {
        status: 503,
        statusText: 'Service Unavailable',
      });

      expect(failed).toBe(true);
    });
  });
});
