import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  provideRouter,
} from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unauthenticatedGuard } from './unauthenticated.guard';
import { AuthService } from '../services/auth.service';

/*
 * The inverse gate: keeps a signed-in user off the login and register screens.
 *
 * Without it, a signed-in user following an old /auth/login bookmark gets a
 * login form, signs in again, and rotates a perfectly good session for no
 * reason.
 */

describe('unauthenticatedGuard', () => {
  const isAuthenticated = signal(false);
  let navigateByUrl: ReturnType<typeof vi.fn>;

  const run = () =>
    TestBed.runInInjectionContext(() =>
      unauthenticatedGuard(
        {} as ActivatedRouteSnapshot,
        { url: '/auth/login' } as RouterStateSnapshot,
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

    navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;
  });

  it('lets a signed-out user reach the login screen', () => {
    expect(run()).toBe(true);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('sends a signed-in user to their messages', () => {
    isAuthenticated.set(true);

    expect(run()).toBe(false);
    expect(navigateByUrl).toHaveBeenCalledWith('/messages');
  });

  it('blocks the navigation as well as redirecting', () => {
    // Returning true alongside the redirect would activate the login route
    // first and flash the form before the redirect lands.
    isAuthenticated.set(true);
    expect(run()).toBe(false);
  });

  it('re-decides on every call rather than caching', () => {
    expect(run()).toBe(true);

    isAuthenticated.set(true);
    expect(run()).toBe(false);

    // After signing out, the login screen has to be reachable again — this is
    // the path taken immediately after logOut() navigates there.
    isAuthenticated.set(false);
    expect(run()).toBe(true);
  });

  it('navigates rather than returning a UrlTree', () => {
    /*
     * Pinned as a difference from authGuard, which returns a UrlTree so the
     * redirect resolves within the same navigation. This one calls navigate()
     * and returns false, which starts a second navigation. Harmless in
     * practice — nothing races it, since the user is already signed in — but
     * the asymmetry is deliberate to notice rather than to copy.
     */
    isAuthenticated.set(true);
    const result = run();

    expect(result).toBe(false);
    expect(navigateByUrl).toHaveBeenCalledOnce();
  });
});
