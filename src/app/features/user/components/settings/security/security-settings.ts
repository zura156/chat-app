import { DatePipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideShieldCheck,
  lucideShieldOff,
  lucideMonitor,
  lucideSmartphone,
} from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';

interface LoginEntry {
  id: string;
  location: string;
  device: 'mobile' | 'desktop';
  date: Date;
  current: boolean;
}

@Component({
  templateUrl: './security-settings.html',
  imports: [
    NgIcon,
    HlmIconImports,
    HlmSeparatorImports,
    HlmButtonImports,
    DatePipe,
  ],
  providers: [
    provideIcons({
      lucideShieldCheck,
      lucideShieldOff,
      lucideMonitor,
      lucideSmartphone,
    }),
  ],
})
export class SecuritySettings {
  twoFactorEnabled = signal(false);

  loginHistory = signal<LoginEntry[]>([
    {
      id: '1',
      location: 'Tbilisi, Georgia',
      device: 'desktop',
      date: new Date(),
      current: true,
    },
    {
      id: '2',
      location: 'Tbilisi, Georgia',
      device: 'mobile',
      date: new Date(Date.now() - 86400000),
      current: false,
    },
    {
      id: '3',
      location: 'Batumi, Georgia',
      device: 'desktop',
      date: new Date(Date.now() - 172800000),
      current: false,
    },
  ]);

  toggleTwoFactor() {
    this.twoFactorEnabled.update((v) => !v);
    // wire up your API call here
  }

  signOutAllDevices() {
    // wire up your API call here
  }
}
