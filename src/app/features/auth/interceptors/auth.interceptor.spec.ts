import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { CSRFService } from '../services/csrf.service';
import { environment } from '../../../../environments/environment';

/*
 * Refresh-and-retry on 401.
 *
 * Almost every rule here exists because a previous version signed people out
 * when it shouldn't have. A rate-limited request is not an expired session; a
 * failed login is not an expired session; a refresh that itself 401s has
 * already been dealt with by the service that made it. Each of those was, at
 * some point, a logout — and a logout from a transient failure is the worst
 * kind of bug to reproduce, because by the time the user complains their
 * session really is gone.
 */

const API = environment.apiUrl;

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;

  let refreshToken: ReturnType<typeof vi.fn>;
  let handleAuthFailure: ReturnType<typeof vi.fn>;
  let getTokenFromCookie: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    refreshToken = vi.fn(() => of({ message: 'ok' }) as Observable<unknown>);
    handleAuthFailure = vi.fn();
    getTokenFromCookie = vi.fn(() => null as string | null);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { refreshToken, handleAuthFailure } },
        { provide: CSRFService, useValue: { getTokenFromCookie } },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    vi.restoreAllMocks();
  });

  /** Fires a request and fails it with `status`, returning the caught error. */
  const failWith = (
    url: string,
    status: number,
    body: Record<string, unknown> | null = {},
  ): { error?: any; response?: unknown } => {
    const result: { error?: any; response?: unknown } = {};
    http.get(url).subscribe({
      next: (r) => (result.response = r),
      error: (e) => (result.error = e),
    });
    httpTesting.expectOne(url).flush(body, { status, statusText: 'Error' });
    return result;
  };

  describe('failures that are not an expired session', () => {
    it('passes a successful response straight through', () => {
      let body: unknown;
      http.get(`${API}/user/me`).subscribe((r) => (body = r));
      httpTesting.expectOne(`${API}/user/me`).flush({ _id: 'u1' });

      expect(body).toEqual({ _id: 'u1' });
      expect(refreshToken).not.toHaveBeenCalled();
    });

    it.each([400, 403, 404, 408, 429, 500, 502, 503])(
      'does not attempt a refresh on a %i',
      (status) => {
        /*
         * The 429 is the one that bit: the rate limiter's answer was treated
         * as "credentials no longer good", so hitting a limit signed the user
         * out — with their cookies still live, because nothing told the
         * server.
         */
        const result = failWith(`${API}/user/me`, status);

        expect(refreshToken).not.toHaveBeenCalled();
        expect(handleAuthFailure).not.toHaveBeenCalled();
        expect(result.error.status).toBe(status);
      },
    );

    it('passes a network failure through untouched', () => {
      // Status 0. The session is fine; the network is not.
      let error: any;
      http.get(`${API}/user/me`).subscribe({ error: (e) => (error = e) });
      httpTesting.expectOne(`${API}/user/me`).error(new ProgressEvent('offline'));

      expect(refreshToken).not.toHaveBeenCalled();
      expect(error.status).toBe(0);
    });
  });

  describe('requests that must not trigger a refresh', () => {
    it('lets a rejected login fail as itself', () => {
      // A 401 here means "wrong password", and refreshing on it would replace
      // that message with a second failure the form cannot explain.
      const result = failWith(`${API}/auth/login`, 401, {
        message: 'Invalid credentials',
      });

      expect(refreshToken).not.toHaveBeenCalled();
      expect(result.error.error.message).toBe('Invalid credentials');
    });

    it('lets a logout fail quietly', () => {
      // Signing out with an already-expired token is normal; refreshing the
      // session in order to end it is not.
      failWith(`${API}/auth/logout`, 401);
      expect(refreshToken).not.toHaveBeenCalled();
    });

    it('does not refresh a refresh', () => {
      /*
       * The recursion guard. `refreshToken()` has already run
       * handleAuthFailure by this point — which closes the socket, resets
       * state and asks the server to drop the cookies. Calling it again from
       * here (what an earlier version did by hand) left the websocket open and
       * the user object loaded.
       */
      const result = failWith(`${API}/auth/refresh`, 401);

      expect(refreshToken).not.toHaveBeenCalled();
      expect(handleAuthFailure).not.toHaveBeenCalled();
      expect(result.error.status).toBe(401);
    });

    it('matches those URLs anywhere in the request URL', () => {
      // The check is a substring, so an absolute API URL still matches.
      failWith(`${API}/auth/login?next=%2Fmessages`, 401);
      expect(refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('token reuse', () => {
    it('signs out immediately rather than trying to refresh', () => {
      /*
       * Reuse means a refresh token was presented twice — either a replay or a
       * stolen cookie. The server has already revoked the family, so a refresh
       * would fail anyway; ending the session at once is the point.
       */
      const result = failWith(`${API}/user/me`, 401, {
        message: 'Refresh token reuse detected',
      });

      expect(handleAuthFailure).toHaveBeenCalledOnce();
      expect(refreshToken).not.toHaveBeenCalled();
      expect(result.error.status).toBe(401);
    });

    it('does not mistake an ordinary 401 for reuse', () => {
      failWith(`${API}/user/me`, 401, { message: 'Unauthorized' });

      expect(handleAuthFailure).not.toHaveBeenCalled();
      expect(refreshToken).toHaveBeenCalledOnce();
      httpTesting.expectOne(`${API}/user/me`).flush({});
    });

    it('survives an error body with no message', () => {
      // Optional chaining, but a gateway's HTML body reaches the same line.
      failWith(`${API}/user/me`, 401, null);

      expect(handleAuthFailure).not.toHaveBeenCalled();
      expect(refreshToken).toHaveBeenCalledOnce();
      httpTesting.expectOne(`${API}/user/me`).flush({});
    });
  });

  describe('refresh and retry', () => {
    it('replays the request once the refresh succeeds', () => {
      let body: unknown;
      http.get(`${API}/user/me`).subscribe((r) => (body = r));
      httpTesting
        .expectOne(`${API}/user/me`)
        .flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(refreshToken).toHaveBeenCalledOnce();

      // The retry: same URL, a second time, now succeeding.
      httpTesting.expectOne(`${API}/user/me`).flush({ _id: 'u1' });
      expect(body).toEqual({ _id: 'u1' });
    });

    it('stamps the retry with the rotated CSRF token', () => {
      /*
       * /auth/refresh rotates the csrfToken cookie. The original request was
       * stamped by httpOptionsInterceptor with the *previous* value, and that
       * interceptor does not run again on a replay — so without re-reading the
       * cookie here, every retried request 403s. Which looks exactly like a
       * CSRF attack in the server logs.
       */
      getTokenFromCookie.mockReturnValue('rotated-token');

      http.post(`${API}/messages`, { body: 'hi' }).subscribe();
      httpTesting
        .expectOne(`${API}/messages`)
        .flush({}, { status: 401, statusText: 'Unauthorized' });

      const retry = httpTesting.expectOne(`${API}/messages`);
      expect(retry.request.headers.get('X-CSRF-TOKEN')).toBe('rotated-token');
      retry.flush({});
    });

    it('replays the original request when no token is available', () => {
      // Better a retry that might 403 than no retry at all.
      getTokenFromCookie.mockReturnValue(null);

      http.get(`${API}/user/me`).subscribe();
      httpTesting
        .expectOne(`${API}/user/me`)
        .flush({}, { status: 401, statusText: 'Unauthorized' });

      const retry = httpTesting.expectOne(`${API}/user/me`);
      expect(retry.request.headers.has('X-CSRF-TOKEN')).toBe(false);
      retry.flush({});
    });

    it('preserves the method and body on the retry', () => {
      // A replayed POST that lost its body silently sends an empty message.
      http.post(`${API}/messages`, { text: 'hello' }).subscribe();
      httpTesting
        .expectOne(`${API}/messages`)
        .flush({}, { status: 401, statusText: 'Unauthorized' });

      const retry = httpTesting.expectOne(`${API}/messages`);
      expect(retry.request.method).toBe('POST');
      expect(retry.request.body).toEqual({ text: 'hello' });
      retry.flush({});
    });

    it('surfaces the refresh failure without signing out a second time', () => {
      /*
       * refreshToken() is the single place that decides whether a failed
       * refresh ends the session, and it only does so on a 401. An earlier
       * version also signed out from here, so a rate-limited refresh logged
       * the user out from two directions at once.
       */
      refreshToken.mockReturnValue(
        throwError(() => ({ status: 429, error: { retryAfter: 30 } })),
      );

      const result = failWith(`${API}/user/me`, 401);

      expect(handleAuthFailure).not.toHaveBeenCalled();
      expect(result.error.status).toBe(429);
    });

    it('does not replay the request when the refresh fails', () => {
      // httpTesting.verify() in afterEach is what enforces this: an
      // unexpected second request fails the test.
      refreshToken.mockReturnValue(throwError(() => ({ status: 401 })));
      failWith(`${API}/user/me`, 401);

      expect(refreshToken).toHaveBeenCalledOnce();
    });

    it('fails the caller when the replay itself 401s, without refreshing again', () => {
      /*
       * Exactly one refresh per failed request, and then the error is the
       * caller's problem.
       *
       * `catchError` does not re-catch errors raised by the observable it
       * returns, so the replay's own 401 propagates rather than re-entering
       * this handler. That is the property worth pinning: a second refresh
       * here would make the pair mutually recursive, and a server answering
       * 401 to everything would produce an unbounded retry loop against it.
       */
      let error: any;
      http.get(`${API}/user/me`).subscribe({ error: (e) => (error = e) });

      httpTesting
        .expectOne(`${API}/user/me`)
        .flush({}, { status: 401, statusText: 'Unauthorized' });
      httpTesting
        .expectOne(`${API}/user/me`)
        .flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(error.status).toBe(401);
      expect(refreshToken).toHaveBeenCalledOnce();
    });
  });
});
