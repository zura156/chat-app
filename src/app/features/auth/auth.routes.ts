import { Routes } from '@angular/router';
import { RegisterComponent } from './components/register/register.component';
import { LoginComponent } from './components/login/login.component';
import { ForgotPasswordComponent } from './components/forgot-password/forgot-password.component';
import { ResetPasswordComponent } from './components/reset-password/reset-password.component';

export const authRoutes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    component: LoginComponent,
  },
  {
    path: 'register',
    component: RegisterComponent,
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
        (m) => m.UnlockAccountComponent
      )
  },
  {
    path: 'verify-email',
    loadComponent: () => 
      import('./components/verify-email/verify-email.component').then(
        (m) => m.VerifyEmailComponent
      )
  },
];
