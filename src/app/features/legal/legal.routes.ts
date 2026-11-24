import { Routes } from '@angular/router';
import { LegalLayout } from './components/legal-layout/legal-layout';

/*
 * Deliberately unguarded — see LegalLayout. These URLs are what the register
 * page, the Help & Support screen, and any app-store listing point at.
 */
export const legalRoutes: Routes = [
  {
    path: '',
    component: LegalLayout,
    children: [
      { path: '', redirectTo: 'privacy', pathMatch: 'full' },
      {
        path: 'privacy',
        title: 'Privacy Policy',
        loadComponent: () =>
          import('./components/privacy-policy/privacy-policy').then(
            (c) => c.PrivacyPolicy,
          ),
      },
      {
        path: 'terms',
        title: 'Terms of Use',
        loadComponent: () =>
          import('./components/terms-of-use/terms-of-use').then(
            (c) => c.TermsOfUse,
          ),
      },
      {
        path: 'cookies',
        title: 'Cookies & Storage',
        loadComponent: () =>
          import('./components/cookie-policy/cookie-policy').then(
            (c) => c.CookiePolicy,
          ),
      },
    ],
  },
];
