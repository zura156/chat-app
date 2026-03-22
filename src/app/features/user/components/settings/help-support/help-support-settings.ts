import { Component, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import {
  lucideChevronDown,
  lucideMail,
  lucideMessageCircle,
  lucideExternalLink,
} from '@ng-icons/lucide';
import { HlmIconImports } from '@spartan-ng/helm/icon';

interface Faq {
  q: string;
  a: string;
  open: ReturnType<typeof signal<boolean>>;
}

@Component({
  imports: [NgIcon, HlmIconImports, HlmSeparatorImports],
  providers: [
    provideIcons({
      lucideChevronDown,
      lucideMail,
      lucideMessageCircle,
      lucideExternalLink,
    }),
  ],
  templateUrl: './help-support-settings.html',
})
export class HelpSupportSettings {
  faqs = signal<Faq[]>([
    {
      q: 'How do I delete a conversation?',
      a: 'Open the conversation, tap the info icon, scroll down and select "Leave group" or "Delete conversation".',
      open: signal(false),
    },
    {
      q: 'Can I recover deleted messages?',
      a: 'No. Deleted messages are permanently removed and cannot be recovered.',
      open: signal(false),
    },
    {
      q: 'How do I change my username?',
      a: 'Go to Settings → Profile and update your username field.',
      open: signal(false),
    },
    {
      q: 'How do I block someone?',
      a: 'Open their profile page, tap the options menu and select "Block user".',
      open: signal(false),
    },
    {
      q: 'Is my data encrypted?',
      a: 'Yes. All messages are encrypted in transit using TLS.',
      open: signal(false),
    },
  ]);
}
