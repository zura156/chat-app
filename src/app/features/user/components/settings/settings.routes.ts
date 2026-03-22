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
        title: 'Profile',
        component: ProfileSettings,
      },
      {
        path: 'account',
        title: 'Account',
        component: AccountSettings,
      },
      {
        path: 'appearance',
        title: 'Appearance',
        component: AppearanceSettings,
      },
      {
        path: 'notifications',
        title: 'Notifications',
        component: Notificationssettings,
      },
      {
        path: 'privacy',
        title: 'Privacy',
        component: PrivacySettings,
      },
      {
        path: 'security',
        title: 'Security',
        component: SecuritySettings,
      },
      {
        path: 'data-storage',
        title: 'Data & Storage',
        component: DataStorageSettings,
      },
      {
        path: 'help-support',
        title: 'Help & Support',
        component: HelpSupportSettings,
      },
    ],
  },
];
