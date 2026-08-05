import { Routes } from '@angular/router';
import { RegisterComponent } from './components/register/register.component';
import { LoginComponent } from './components/login/login.component';
import { ForgotPasswordComponent } from './components/forgot-password/forgot-password.component';
import { unauthenticatedGuard } from './guards/unauthenticated.guard';

export const authRoutes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  // The only two pages that are meaningless with a live session.
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [unauthenticatedGuard],
  },
  {
    path: 'register',
    component: RegisterComponent,
    canActivate: [unauthenticatedGuard],
  },
  {
    path: 'forgot-password',
    component: ForgotPasswordComponent,
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./components/reset-password/reset-password.component').then(
        (m) => m.ResetPasswordComponent,
      ),
  },
  {
    path: 'unlock-account',
    loadComponent: () =>
      import('./components/unlock-account/unlock-account.component').then(
        (m) => m.UnlockAccountComponent,
      ),
  },
  {
    path: 'verify-email',
    loadComponent: () =>
      import('./components/verify-email/verify-email.component').then(
        (m) => m.VerifyEmailComponent,
      ),
  },
  {
    // Must match the link built by generateLink(EMAIL_CHANGE) on the server.
    path: 'confirm-email',
    loadComponent: () =>
      import('./components/verify-email/confirm-email-change.component').then(
        (m) => m.ConfirmEmailChangeComponent,
      ),
  },
];
