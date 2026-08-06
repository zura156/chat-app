import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

/*
 * Gate on every signed-in route.
 *
 * Two decisions here are worth pinning. It returns a UrlTree rather than
 * calling navigate() and returning false — the router applies a UrlTree while
 * resolving *this* navigation, instead of racing a second one against the
 * first. And it records where the user was going, which is only useful because
 * AuthService.completeLogin now actually reads it back; before that, every
 * deep link was recorded here and silently discarded at the login screen.
 */

describe('authGuard', () => {
  const isAuthenticated = signal(false);

  const run = (url: string) =>
    TestBed.runInInjectionContext(() =>
      authGuard(
        {} as ActivatedRouteSnapshot,
        { url } as RouterStateSnapshot,
      ),
    );

  beforeEach(() => {
    isAuthenticated.set(false);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthService, useValue: { isAuthenticated } },
      ],
    });
  });

  it('lets a signed-in user through', () => {
    isAuthenticated.set(true);
    expect(run('/messages')).toBe(true);
  });

  it('redirects a signed-out user to login', () => {
    const result = run('/messages');

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toContain(
      '/auth/login',
    );
  });

  it('sends them to login rather than register', () => {
    // Someone hitting a protected route almost always already has an account;
    // the sign-up form is a dead end for them.
    const url = TestBed.inject(Router).serializeUrl(run('/messages') as UrlTree);
    expect(url).not.toContain('/auth/register');
  });

  it('records where the user was headed', () => {
    const tree = run('/messages/507f1f77bcf86cd799439011') as UrlTree;
    expect(tree.queryParams['returnUrl']).toBe(
      '/messages/507f1f77bcf86cd799439011',
    );
  });

  it('keeps the query string of the blocked URL', () => {
    // A shared link's parameters are part of where the user was going; losing
    // them lands the user on the right page in the wrong state.
    const tree = run('/messages/abc?tab=media&highlight=42') as UrlTree;
    expect(tree.queryParams['returnUrl']).toBe(
      '/messages/abc?tab=media&highlight=42',
    );
  });

  it('does not double-encode the return URL', () => {
    // The router encodes on serialization; encoding here as well produces a
    // returnUrl that navigates nowhere.
    const tree = run('/messages/abc?tab=media') as UrlTree;
    expect(tree.queryParams['returnUrl']).toBe('/messages/abc?tab=media');
  });

  it('returns a UrlTree rather than navigating itself', () => {
    /*
     * The distinction that matters: navigate() + false starts a *second*
     * navigation while the first is still resolving, and the two can land in
     * either order. Returning a tree makes the redirect part of the same
     * navigation.
     */
    const router = TestBed.inject(Router);
    const before = router.url;

    const result = run('/messages');

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.url).toBe(before);
  });

  it('re-decides on every call rather than caching', () => {
    // The same guard instance serves the whole session, across sign-in and
    // sign-out.
    expect(run('/messages')).toBeInstanceOf(UrlTree);

    isAuthenticated.set(true);
    expect(run('/messages')).toBe(true);

    isAuthenticated.set(false);
    expect(run('/messages')).toBeInstanceOf(UrlTree);
  });
});
