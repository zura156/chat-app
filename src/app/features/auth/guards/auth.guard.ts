import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) return true;

  // Login, not register. Someone hitting a protected route almost always
  // already has an account, and the sign-up form is a dead end for them.
  //
  // `returnUrl` is now actually read after a successful sign-in (see
  // AuthService.completeLogin); it was recorded here and discarded before.
  //
  // Returning a UrlTree rather than calling navigate() + returning false: the
  // router applies it as part of resolving this navigation, instead of racing a
  // second one against the first.
  return router.createUrlTree(['/auth/login'], {
    queryParams: { returnUrl: state.url },
  });
};
