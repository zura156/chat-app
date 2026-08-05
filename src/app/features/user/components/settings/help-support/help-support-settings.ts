import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import {
  lucideChevronDown,
  lucideCopy,
  lucideExternalLink,
  lucideMail,
} from '@ng-icons/lucide';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { toast } from '@spartan-ng/brain/sonner';
import { environment } from '../../../../../../environments/environment';
import { WebSocketService } from '../../../../messages/services/web-socket.service';

interface Faq {
  q: string;
  a: string;
  open: ReturnType<typeof signal<boolean>>;
}

/**
 * The FAQ here was always real; the rest of the screen was not. It advertised a
 * support address (`support@yourapp.com`), a "Live chat" card pointing at `#`,
 * and version 1.0.0 against a package that reports 0.0.0 — a page whose whole
 * job is to help someone in trouble, telling them three things that were not
 * true.
 *
 * Contact details are configuration now, and a row that has not been configured
 * is simply not shown. What replaces the invented parts is the thing a support
 * screen can genuinely offer without a helpdesk behind it: a copyable summary
 * of the client's actual state, so a bug report arrives with something useful
 * attached instead of "it doesn't work".
 */
@Component({
  imports: [NgIcon, HlmIconImports, HlmSeparatorImports, HlmButtonImports],
  providers: [
    provideIcons({
      lucideChevronDown,
      lucideMail,
      lucideExternalLink,
      lucideCopy,
    }),
  ],
  templateUrl: './help-support-settings.html',
})
export class HelpSupportSettings {
  private readonly webSocket = inject(WebSocketService);

  readonly supportEmail = environment.supportEmail;
  readonly termsUrl = environment.termsUrl;
  readonly privacyUrl = environment.privacyUrl;
  readonly appVersion = environment.appVersion;

  readonly hasAppInfo = computed(
    () => !!this.appVersion || !!this.termsUrl || !!this.privacyUrl,
  );

  faqs = signal<Faq[]>([
    {
      q: 'How do I change my password?',
      a: 'Go to Settings → Security. You will need your current password, and every other device is signed out once it changes.',
      open: signal(false),
    },
    {
      q: 'How do I change my email address?',
      a: 'Go to Settings → Account. A confirmation link is sent to the new address, and nothing changes until you open it.',
      open: signal(false),
    },
    {
      q: 'How do I delete a conversation?',
      a: 'Open the conversation, tap the info icon, scroll down and select "Leave group" or "Delete conversation".',
      open: signal(false),
    },
    {
      q: 'Can I recover deleted messages?',
      a: 'No. Deleting a message clears its text and attachments immediately and permanently. An empty placeholder stays in the thread so the conversation still reads in order.',
      open: signal(false),
    },
    {
      q: 'Why can I not record a voice message?',
      a: 'Recording needs microphone permission and a secure (https) connection. If either is missing, the recorder tells you which one when you open it.',
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
      a: 'Messages are encrypted in transit with TLS and stored on our servers. They are not end-to-end encrypted, so treat what you send as readable by the service.',
      open: signal(false),
    },
  ]);

  /**
   * What a support request needs and a user cannot reasonably be asked to find.
   *
   * Deliberately limited to what the browser already tells every site it
   * visits: no account identifiers, nothing from any conversation, nothing that
   * turns a pasted diagnostic into a privacy problem.
   */
  private diagnostics(): string {
    return [
      this.appVersion ? `App: ${this.appVersion}` : null,
      `URL: ${window.location.origin}`,
      `Browser: ${navigator.userAgent}`,
      `Language: ${navigator.language}`,
      `Screen: ${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}x`,
      `Viewport: ${window.innerWidth}x${window.innerHeight}`,
      `Secure context: ${window.isSecureContext ? 'yes' : 'no'}`,
      `Realtime: ${this.webSocket.connected() ? 'connected' : 'disconnected'}`,
      `Time: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  readonly diagnosticsText = computed(() => this.diagnostics());

  copyDiagnostics(): void {
    navigator.clipboard
      ?.writeText(this.diagnostics())
      .then(() => toast.success('Diagnostics copied'))
      .catch(() => toast.error('Could not copy — select the text and copy it'));
  }

  /** Pre-fills the support mail so the diagnostics are attached by default. */
  supportMailtoHref(): string {
    const subject = encodeURIComponent('Support request');
    const body = encodeURIComponent(
      `\n\n---\nThe details below help us reproduce the problem.\n\n${this.diagnostics()}`,
    );
    return `mailto:${this.supportEmail}?subject=${subject}&body=${body}`;
  }
}
