import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LEGAL } from '../../legal.config';
import { LegalFactComponent } from '../legal-fact/legal-fact';

interface StorageItem {
  name: string;
  purpose: string;
  lifetime: string;
}

interface StorageGroup {
  id: string;
  title: string;
  intro: string;
  items: readonly StorageItem[];
  note?: string;
}

/**
 * The inventory below is the whole list, read from the code: every
 * `res.cookie(...)` on the server and every `localStorage` / `sessionStorage`
 * key on the client. All of it is strictly necessary or remembers a choice the
 * user made, which is why there is no consent banner — the ePrivacy exemption
 * covers exactly this. Adding analytics, ads or a third-party embed ends that
 * exemption: add a consent prompt *and* a row here in the same change.
 */
@Component({
  imports: [RouterLink, DatePipe, LegalFactComponent],
  templateUrl: './cookie-policy.html',
  styleUrl: '../legal-document.css',
})
export class CookiePolicy {
  protected readonly legal = LEGAL;

  private readonly cookies: readonly StorageItem[] = [
    {
      name: 'accessToken',
      purpose:
        'Proves to our server that you are signed in. Not readable by scripts.',
      lifetime: 'Short-lived; renewed automatically while you use the app',
    },
    {
      name: 'refreshToken',
      purpose:
        'Renews your sign-in without asking for your password again. Sent only to the renewal endpoint and not readable by scripts.',
      lifetime: '7 days',
    },
    {
      name: 'csrfToken',
      purpose:
        'Protects your account from cross-site request forgery — other websites making requests as you.',
      lifetime: '24 hours',
    },
    {
      name: 'twoFactorChallenge',
      purpose:
        'Remembers that your password was correct while you enter your two-factor code. Set only if two-factor authentication is on.',
      lifetime: '10 minutes',
    },
    {
      name: 'oidcTx',
      purpose:
        'Holds the in-progress handshake while you sign in with Google or GitHub. Set only if you use one of them.',
      lifetime: '10 minutes',
    },
  ];

  private readonly localStorage: readonly StorageItem[] = [
    {
      name: 'theme',
      purpose: 'Light, dark or system appearance',
      lifetime: 'Until you clear it',
    },
    {
      name: 'colorTheme',
      purpose: 'Your accent colour',
      lifetime: 'Until you clear it',
    },
    {
      name: 'isAuthenticated',
      purpose:
        'Whether this browser is signed in, so the app opens on the right screen. Holds no credentials.',
      lifetime: 'Until you sign out',
    },
    {
      name: 'prefers-chat-settings-open',
      purpose: 'Whether the conversation details panel is open',
      lifetime: 'Until you clear it',
    },
    {
      name: 'video-player-volume',
      purpose: 'Your video volume',
      lifetime: 'Until you clear it',
    },
  ];

  private readonly sessionStorage: readonly StorageItem[] = [
    {
      name: 'selectedUser',
      purpose: 'Which profile you are viewing, so it survives a page reload',
      lifetime: 'Until the tab is closed',
    },
    {
      name: 'oidcReturnUrl',
      purpose:
        'Where to take you back to after signing in with Google or GitHub',
      lifetime: 'Until the tab is closed',
    },
  ];

  protected readonly groups: readonly StorageGroup[] = [
    {
      id: 'cookies',
      title: 'Cookies',
      intro:
        'Set by our API server. They are strictly necessary: without them you could not sign in, and your account would be exposed to forged requests.',
      items: this.cookies,
      note: 'The network provider that protects our servers may also set its own strictly necessary security cookies to tell people apart from automated attacks.',
    },
    {
      id: 'local-storage',
      title: 'Local storage',
      intro:
        'Kept in your browser and never sent to our servers. It remembers display preferences on this device.',
      items: this.localStorage,
    },
    {
      id: 'session-storage',
      title: 'Session storage',
      intro: 'Like local storage, but cleared when you close the tab.',
      items: this.sessionStorage,
    },
  ];
}
