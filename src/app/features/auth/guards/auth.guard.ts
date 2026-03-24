import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const isAuthenticated = authService.isAuthenticated();
  // const requiredRole = route.data?.['role'];

  if (!isAuthenticated) {
    router.navigate(['/auth/register'], {
      queryParams: { returnUrl: state.url },
    });
    return false;
  }

  // if (requiredRole) {
  //   const user = authService.user();

  //   if (user?.role !== requiredRole) {
  //     router.createUrlTree(['/auth/login'], {
  //       queryParams: { returnUrl: state.url },
  //     });
  //     return false;
  //   }
  // }

  return true;
};
