import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignedMediaService, mediaIdentity } from './signed-media.service';
import { environment } from '../../../environments/environment';

/*
 * Recovering media whose presigned URL has expired.
 *
 * Attachment URLs are signed with a fixed lifetime, so a tab left open or a
 * long scroll back through history can reach a URL that was valid when it was
 * handed over and is not now. The symptom this fixes is a player stuck on a
 * broken state whose "Try again" reloaded the same dead URL forever.
 *
 * The sharing is the delicate part: one expiry usually hits every element
 * showing that upload at once — the bubble, the media grid, the full-screen
 * viewer — so a naive implementation sends a burst of identical requests, and
 * an over-eager cache turns the recovery into a one-shot-per-session fix.
 */

const url = (id: string) => `${environment.apiUrl}/upload/signed-url/${id}`;

describe('mediaIdentity', () => {
  /*
   * Presigned URLs carry their credentials in the query string, so two URLs
   * for the same stored object are different strings whenever they were signed
   * at different times. Anything asking "is this still the same media?" — the
   * viewer deciding whether to reset zoom, the player deciding whether to
   * reload — has to compare the path.
   */

  it('treats two signings of the same object as the same media', () => {
    const first = 'https://s3.example.com/uploads/abc.jpg?X-Amz-Signature=aaa';
    const second = 'https://s3.example.com/uploads/abc.jpg?X-Amz-Signature=bbb';

    expect(mediaIdentity(first)).toBe(mediaIdentity(second));
  });

  it('keeps different objects distinct', () => {
    expect(mediaIdentity('https://s3.example.com/uploads/a.jpg')).not.toBe(
      mediaIdentity('https://s3.example.com/uploads/b.jpg'),
    );
  });

  it('keeps the host, so the same path on two buckets is not confused', () => {
    expect(mediaIdentity('https://one.example.com/uploads/a.jpg')).not.toBe(
      mediaIdentity('https://two.example.com/uploads/a.jpg'),
    );
  });

  it('drops the whole query string, not just the signature', () => {
    const identity = mediaIdentity(
      'https://s3.example.com/uploads/a.jpg?X-Amz-Expires=900&X-Amz-Date=2024',
    );
    expect(identity).toBe('https://s3.example.com/uploads/a.jpg');
  });

  it('ignores a fragment', () => {
    expect(mediaIdentity('https://s3.example.com/uploads/a.jpg#t=10')).toBe(
      'https://s3.example.com/uploads/a.jpg',
    );
  });

  it('resolves a relative URL against the page', () => {
    // Local development serves uploads from the same origin.
    expect(mediaIdentity('/uploads/a.jpg?sig=x')).toBe(
      `${window.location.origin}/uploads/a.jpg`,
    );
  });

  it('returns an empty string for no URL', () => {
    // An attachment still processing has no URL yet, and the placeholder asks
    // for its identity anyway.
    expect(mediaIdentity(null)).toBe('');
    expect(mediaIdentity(undefined)).toBe('');
    expect(mediaIdentity('')).toBe('');
  });

  it('resolves almost any junk rather than reaching the fallback', () => {
    /*
     * Worth knowing: because a base is supplied, `new URL` treats anything
     * that is not a valid *absolute* URL as a path relative to the page, so it
     * succeeds on input that looks unparseable. The identity of a garbled URL
     * is therefore an absolute URL against the app's own origin — stable and
     * comparable, which is all the callers need.
     */
    expect(mediaIdentity('::not a url::?sig=x')).toBe(
      `${window.location.origin}/::not%20a%20url::`,
    );
  });

  it('falls back to trimming the query for input even that cannot parse', () => {
    // Reachable only for a malformed *absolute* URL. Better a usable
    // comparison than a thrown error inside change detection.
    expect(mediaIdentity('http://?sig=x')).toBe('http://');
    expect(mediaIdentity('https://%?sig=x')).toBe('https://%');
  });
});

describe('SignedMediaService', () => {
  let service: SignedMediaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(SignedMediaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('returns the fresh variants', () => {
    let variants: Record<string, string> | null = null;
    service.refresh('up1').subscribe((v) => (variants = v));

    http.expectOne(url('up1')).flush({
      variants: { thumb: 'https://s3/a-thumb.jpg?sig=new' },
    });

    expect(variants).toEqual({ thumb: 'https://s3/a-thumb.jpg?sig=new' });
  });

  it('sends one request when several elements ask at once', () => {
    /*
     * The burst this exists to prevent. `expectOne` is the assertion — a
     * second request would fail it.
     */
    const results: unknown[] = [];
    service.refresh('up1').subscribe((v) => results.push(v));
    service.refresh('up1').subscribe((v) => results.push(v));
    service.refresh('up1').subscribe((v) => results.push(v));

    http.expectOne(url('up1')).flush({ variants: { thumb: 'x' } });

    expect(results).toHaveLength(3);
    expect(results.every((r) => JSON.stringify(r) === '{"thumb":"x"}')).toBe(true);
  });

  it('replays the result to a subscriber that arrives late', () => {
    // The viewer can mount after the bubble has already triggered the refresh.
    service.refresh('up1').subscribe();
    http.expectOne(url('up1')).flush({ variants: { thumb: 'x' } });

    let variants: Record<string, string> | null = null;
    service.refresh('up1').subscribe((v) => (variants = v));

    expect(variants).toEqual({ thumb: 'x' });
    http.expectNone(url('up1'));
  });

  it('keeps different uploads apart', () => {
    const seen: Record<string, unknown> = {};
    service.refresh('up1').subscribe((v) => (seen['up1'] = v));
    service.refresh('up2').subscribe((v) => (seen['up2'] = v));

    http.expectOne(url('up1')).flush({ variants: { thumb: 'one' } });
    http.expectOne(url('up2')).flush({ variants: { thumb: 'two' } });

    expect(seen['up1']).toEqual({ thumb: 'one' });
    expect(seen['up2']).toEqual({ thumb: 'two' });
  });

  it('does nothing without an upload id', () => {
    // Reached whenever an attachment record is rendered before it is complete.
    let variants: Record<string, string> | null = { thumb: 'stale' };
    service.refresh('').subscribe((v) => (variants = v));

    expect(variants).toBeNull();
    http.expectNone(url(''));
  });

  it('emits null rather than failing when the object is gone', () => {
    /*
     * A deleted upload 404s here. The caller is an image or a video element's
     * error handler, and an error observable there means an unhandled rejection
     * inside change detection — so the failure is turned into "no variants",
     * which the player already knows how to show.
     */
    let variants: Record<string, string> | null = { thumb: 'stale' };
    let errored = false;
    service.refresh('gone').subscribe({
      next: (v) => (variants = v),
      error: () => (errored = true),
    });

    http.expectOne(url('gone')).flush({}, { status: 404, statusText: 'Not Found' });

    expect(errored).toBe(false);
    expect(variants).toBeNull();
  });

  it('emits null when the server answers with no variants', () => {
    let variants: Record<string, string> | null = { thumb: 'stale' };
    service.refresh('up1').subscribe((v) => (variants = v));

    http.expectOne(url('up1')).flush({ variants: null });

    expect(variants).toBeNull();
  });

  it('emits null when the body is empty', () => {
    let variants: Record<string, string> | null = { thumb: 'stale' };
    service.refresh('up1').subscribe((v) => (variants = v));

    http.expectOne(url('up1')).flush(null);

    expect(variants).toBeNull();
  });

  it('re-requests after the cached entry is dropped', () => {
    /*
     * The signed URLs handed back here expire too. Without `invalidate`, the
     * cached response would be replayed forever and the *second* expiry of a
     * session would be unrecoverable — which is the original bug, moved one
     * step further out.
     */
    service.refresh('up1').subscribe();
    http.expectOne(url('up1')).flush({ variants: { thumb: 'first' } });

    service.invalidate('up1');

    let variants: Record<string, string> | null = null;
    service.refresh('up1').subscribe((v) => (variants = v));
    http.expectOne(url('up1')).flush({ variants: { thumb: 'second' } });

    expect(variants).toEqual({ thumb: 'second' });
  });

  it('ignores an invalidate for an upload it never fetched', () => {
    expect(() => service.invalidate('never-seen')).not.toThrow();
  });

  it('leaves other uploads cached when one is invalidated', () => {
    service.refresh('up1').subscribe();
    http.expectOne(url('up1')).flush({ variants: { thumb: 'one' } });
    service.refresh('up2').subscribe();
    http.expectOne(url('up2')).flush({ variants: { thumb: 'two' } });

    service.invalidate('up1');

    service.refresh('up2').subscribe();
    http.expectNone(url('up2'));

    service.refresh('up1').subscribe();
    http.expectOne(url('up1')).flush({ variants: { thumb: 'one-again' } });
  });
});
