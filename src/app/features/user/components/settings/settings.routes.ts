import { Routes } from '@angular/router';
import { AccountSettings } from './account/account-settings';
import { ProfileSettings } from './profile/profile-settings';
import { UserSettingsLayout } from './layout/user-settings-layout';
import { Notificationssettings } from './notifications/notifications-settings';
import { AppearanceSettings } from './appearance/appearance-settings';
import { PrivacySettings } from './privacy/privacy-settings';
import { DataStorageSettings } from './data-storage/data-storage-settings';
import { SecuritySettings } from './security/security-settings';
import { HelpSupportSettings } from './help-support/help-support-settings';

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
      {
        path: 'appearance',
        component: AppearanceSettings,
      },
      {
        path: 'notifications',
        component: Notificationssettings,
      },
      {
        path: 'privacy',
        component: PrivacySettings,
      },
      {
        path: 'security',
        component: SecuritySettings,
      },
      {
        path: 'data-storage',
        component: DataStorageSettings,
      },
      {
        path: 'help-support',
        component: HelpSupportSettings,
      },
    ],
  },
];
