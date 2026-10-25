import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OidcCallbackComponent } from './oidc-callback.component';
import { AuthService } from '../../services/auth.service';

/*
 * The landing page after a provider sign-in. Success is AuthService's to
 * navigate (it honours the parked returnUrl); this page only has to finish the
 * sign-in and, if the session turns out not to work, say so on the login page
 * instead of leaving a spinner up forever.
 */

const authService = { completeOidcLogin: vi.fn() };

const build = async () => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [OidcCallbackComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: authService },
    ],
  });
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(OidcCallbackComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, navigate };
};

describe('OidcCallbackComponent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finishes the sign-in and leaves the navigation to it', async () => {
    authService.completeOidcLogin.mockReturnValue(of({ _id: 'u1' }));
    const { fixture, navigate } = await build();

    expect(authService.completeOidcLogin).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Signing you in');
  });

  it('sends a sign-in whose session does not work back to the login page', async () => {
    authService.completeOidcLogin.mockReturnValue(
      throwError(() => ({ status: 401 })),
    );
    const { navigate } = await build();

    expect(navigate).toHaveBeenCalledWith(['/auth/login'], {
      queryParams: { error: 'oidc_failed' },
    });
  });
});
