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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpOptionsInterceptor } from './http-options.interceptor';
import { UserStateService } from '../../user/services/user-state.service';
import { environment } from '../../../../environments/environment';

const toast = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock('@spartan-ng/brain/sonner', () => ({ toast }));

/*
 * Stamps outgoing requests and reads two specific refusals off the responses.
 *
 * The URL check is the load-bearing part. Uploads go straight to storage on a
 * presigned URL, where the signature covers the headers — adding one breaks it,
 * and `withCredentials` breaks CORS before that. This used to test for a single
 * hardcoded production hostname, so every non-production deployment was
 * stamping requests it shouldn't and skipping ones it should.
 */

const API = environment.apiUrl;

describe('httpOptionsInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let userState: UserStateService;

  beforeEach(() => {
    document.cookie = 'csrfToken=; Max-Age=0; path=/';

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([httpOptionsInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
    userState = TestBed.inject(UserStateService);
  });

  afterEach(() => {
    httpTesting.verify();
    document.cookie = 'csrfToken=; Max-Age=0; path=/';
    vi.clearAllMocks();
  });

  describe('which requests get stamped', () => {
    it('sends cookies with a request to our own API', () => {
      http.get(`${API}/user/me`).subscribe();

      const request = httpTesting.expectOne(`${API}/user/me`);
      expect(request.request.withCredentials).toBe(true);
      request.flush({});
    });

    it('attaches the CSRF token when one exists', () => {
      document.cookie = 'csrfToken=tok123; path=/';
      http.post(`${API}/messages`, {}).subscribe();

      const request = httpTesting.expectOne(`${API}/messages`);
      expect(request.request.headers.get('X-CSRF-TOKEN')).toBe('tok123');
      request.flush({});
    });

    it('omits the header entirely when there is no token', () => {
      // Sending an empty header is not the same as sending none — the server
      // reads a present-but-blank value as a failed check.
      http.post(`${API}/messages`, {}).subscribe();

      const request = httpTesting.expectOne(`${API}/messages`);
      expect(request.request.headers.has('X-CSRF-TOKEN')).toBe(false);
      request.flush({});
    });

    it('leaves a presigned storage upload completely untouched', () => {
      /*
       * The reason this interceptor has a URL check at all. The signature on
       * a presigned PUT covers the headers, so an extra one makes the upload
       * 403 — and `withCredentials` fails the CORS preflight before the
       * request is even sent.
       */
      document.cookie = 'csrfToken=tok123; path=/';
      const url = `${environment.s3Url}/uploads/abc?X-Amz-Signature=deadbeef`;
      http.put(url, new Blob(['x'])).subscribe();

      const request = httpTesting.expectOne(url);
      expect(request.request.withCredentials).toBe(false);
      expect(request.request.headers.has('X-CSRF-TOKEN')).toBe(false);
      request.flush(null);
    });

    it('does not stamp a request to an unrelated third party', () => {
      document.cookie = 'csrfToken=tok123; path=/';
      http.get('https://example.com/thing').subscribe();

      const request = httpTesting.expectOne('https://example.com/thing');
      expect(request.request.withCredentials).toBe(false);
      expect(request.request.headers.has('X-CSRF-TOKEN')).toBe(false);
      request.flush({});
    });

    it('stamps every method, not only the mutating ones', () => {
      // A GET needs the cookies as much as a POST — that is what identifies
      // the session at all.
      document.cookie = 'csrfToken=tok123; path=/';

      for (const url of [`${API}/a`, `${API}/b`]) http.get(url).subscribe();

      for (const url of [`${API}/a`, `${API}/b`]) {
        const request = httpTesting.expectOne(url);
        expect(request.request.withCredentials).toBe(true);
        request.flush({});
      }
    });

    it('preserves headers the caller set', () => {
      document.cookie = 'csrfToken=tok123; path=/';
      http
        .post(`${API}/messages`, {}, { headers: { 'X-Client': 'test' } })
        .subscribe();

      const request = httpTesting.expectOne(`${API}/messages`);
      expect(request.request.headers.get('X-Client')).toBe('test');
      expect(request.request.headers.get('X-CSRF-TOKEN')).toBe('tok123');
      request.flush({});
    });
  });

  describe('rate limiting', () => {
    it('shows the server’s explanation on a 429', () => {
      http.post(`${API}/auth/login`, {}).subscribe({ error: () => undefined });

      httpTesting.expectOne(`${API}/auth/login`).flush(
        { message: 'Too many attempts. Try again in 60 seconds.' },
        { status: 429, statusText: 'Too Many Requests' },
      );

      expect(toast.warning).toHaveBeenCalledWith(
        'Too many attempts. Try again in 60 seconds.',
      );
    });

    it('falls back to a generic message when the server sends none', () => {
      http.post(`${API}/auth/login`, {}).subscribe({ error: () => undefined });

      httpTesting
        .expectOne(`${API}/auth/login`)
        .flush({}, { status: 429, statusText: 'Too Many Requests' });

      expect(toast.warning).toHaveBeenCalledWith(
        'Too many requests. Please try again later.',
      );
    });

    it('still fails the request after warning', () => {
      // The toast explains; it does not resolve. A caller that thought the
      // request succeeded would render an empty result as real data.
      let status: number | undefined;
      http
        .post(`${API}/auth/login`, {})
        .subscribe({ error: (e) => (status = e.status) });

      httpTesting
        .expectOne(`${API}/auth/login`)
        .flush({}, { status: 429, statusText: 'Too Many Requests' });

      expect(status).toBe(429);
    });

    it('does not warn on other failures', () => {
      // A 500 gets whatever handling the caller has; a toast here would put
      // "too many requests" on an unrelated bug.
      for (const status of [400, 401, 403, 500]) {
        http.get(`${API}/thing`).subscribe({ error: () => undefined });
        httpTesting
          .expectOne(`${API}/thing`)
          .flush({}, { status, statusText: 'Error' });
      }

      expect(toast.warning).not.toHaveBeenCalled();
    });
  });

  describe('the email verification wall', () => {
    it('records the refusal when the API rejects for an unverified address', () => {
      /*
       * Set from the server's answer rather than from a client-side copy of
       * the deployment setting — a mirrored config is one redeploy away from
       * showing a "verify your email" wall to users the server is happy to
       * serve.
       */
      expect(userState.emailVerificationRequired()).toBe(false);

      http.get(`${API}/conversations`).subscribe({ error: () => undefined });
      httpTesting.expectOne(`${API}/conversations`).flush(
        { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email' },
        { status: 403, statusText: 'Forbidden' },
      );

      expect(userState.emailVerificationRequired()).toBe(true);
    });

    it('ignores a 403 that is about something else', () => {
      // Blocked users and non-members also produce a 403; a wall shown for
      // those tells the user to verify an address that is already verified.
      http.get(`${API}/conversations/x`).subscribe({ error: () => undefined });
      httpTesting
        .expectOne(`${API}/conversations/x`)
        .flush(
          { code: 'NOT_A_MEMBER' },
          { status: 403, statusText: 'Forbidden' },
        );

      expect(userState.emailVerificationRequired()).toBe(false);
    });

    it('ignores the same code on a status that is not 403', () => {
      http.get(`${API}/conversations`).subscribe({ error: () => undefined });
      httpTesting
        .expectOne(`${API}/conversations`)
        .flush(
          { code: 'EMAIL_NOT_VERIFIED' },
          { status: 400, statusText: 'Bad Request' },
        );

      expect(userState.emailVerificationRequired()).toBe(false);
    });

    it('survives an error body that is not an object', () => {
      // Gateways return HTML or plain text; reaching into `.code` on those
      // must not throw inside the interceptor and mask the real failure.
      let status: number | undefined;
      http
        .get(`${API}/conversations`)
        .subscribe({ error: (e) => (status = e.status) });

      httpTesting
        .expectOne(`${API}/conversations`)
        .flush('<html>gateway</html>', { status: 403, statusText: 'Forbidden' });

      expect(status).toBe(403);
      expect(userState.emailVerificationRequired()).toBe(false);
    });
  });

  it('does not read a failure from a request it skipped', () => {
    // The early return means storage failures never reach any of this.
    const url = `${environment.s3Url}/uploads/abc`;
    http.put(url, new Blob(['x'])).subscribe({ error: () => undefined });

    httpTesting
      .expectOne(url)
      .flush({}, { status: 429, statusText: 'Too Many Requests' });

    expect(toast.warning).not.toHaveBeenCalled();
  });
});
