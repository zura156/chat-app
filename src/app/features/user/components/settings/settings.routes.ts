import { Routes } from '@angular/router';
import { AccountSettings } from './account/account-settings';
import { ProfileSettings } from './profile/profile-settings';
import { UserSettingsLayout } from './layout/user-settings-layout';

export const settingsRoutes: Routes = [
  {
    path: '',
    component: UserSettingsLayout,
    children: [
      {
        path: '',
        redirectTo: 'profile',
        pathMatch: 'full',
      },
      {
        path: 'profile',
        component: ProfileSettings,
      },
      {
        path: 'account',
        component: AccountSettings,
      },
    ],
  },
];
