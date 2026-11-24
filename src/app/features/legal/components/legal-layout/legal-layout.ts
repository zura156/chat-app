import { Component, inject } from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { ThemeService } from '../../../../shared/services/theme.service';
import { LEGAL, MISSING_LEGAL_FACTS } from '../../legal.config';
import { LegalFactComponent } from '../legal-fact/legal-fact';

/**
 * The frame around every legal page: a way back into the app, tabs between the
 * documents, and the contact line a reader is most likely to be looking for.
 *
 * Mounted without any guard. These pages have to open for someone who has no
 * account yet (the register page links here), someone signed out, and app
 * store or regulator reviewers following the URL cold — a privacy policy
 * behind a login is not published.
 */
@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    DatePipe,
    NgOptimizedImage,
    NgIcon,
    HlmIcon,
    HlmButton,
    LegalFactComponent,
  ],
  providers: [provideIcons({ lucideArrowLeft, lucideTriangleAlert })],
  template: `
    <div class="min-h-dvh flex flex-col">
      <header class="border-b border-border">
        <div
          class="mx-auto flex w-full max-w-[46rem] items-center justify-between gap-4 px-4 pt-4"
        >
          <a
            routerLink="/"
            class="flex items-center gap-2.5 font-semibold tracking-tight"
          >
            <img
              [ngSrc]="
                isDarkMode() ? '/chat-favicon-light.png' : '/chat-favicon.png'
              "
              width="28"
              height="28"
              alt=""
              class="rounded-md border border-border"
            />
            {{ serviceName }}
          </a>
          <a
            hlmBtn
            variant="ghost"
            size="sm"
            class="rounded-full"
            routerLink="/"
          >
            <ng-icon hlm name="lucideArrowLeft" size="sm" aria-hidden="true" />
            Back to the app
          </a>
        </div>

        <nav
          aria-label="Legal documents"
          class="mx-auto flex w-full max-w-[46rem] gap-1 overflow-x-auto px-4 pt-3"
        >
          @for (doc of documents; track doc.path) {
            <a
              [routerLink]="doc.path"
              routerLinkActive="border-foreground text-foreground"
              ariaCurrentWhenActive="page"
              class="shrink-0 border-b-2 border-transparent px-3 pb-2.5 pt-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {{ doc.label }}
            </a>
          }
        </nav>
      </header>

      @if (missing.length) {
        <div class="mx-auto w-full max-w-[46rem] px-4 pt-6">
          <div
            role="note"
            class="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
          >
            <ng-icon
              hlm
              name="lucideTriangleAlert"
              size="sm"
              class="mt-0.5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <p>
              <strong class="font-semibold">Draft — not ready to publish.</strong>
              Missing: {{ missing.join(', ') }}. Set them in
              <code class="text-xs">features/legal/legal.config.ts</code>; the
              highlighted gaps in the text fill in from there.
            </p>
          </div>
        </div>
      }

      <main class="flex-1">
        <router-outlet />
      </main>

      <footer class="border-t border-border">
        <div
          class="mx-auto w-full max-w-[46rem] space-y-1 px-4 py-6 text-xs text-muted-foreground"
        >
          <p>
            Questions about these documents:
            <app-legal-fact fact="contactEmail" />
          </p>
          <p>
            Last updated
            <time [attr.datetime]="lastUpdated">{{
              lastUpdated | date: 'longDate'
            }}</time>
          </p>
        </div>
      </footer>
    </div>
  `,
})
export class LegalLayout {
  protected readonly isDarkMode = inject(ThemeService).isDarkMode;

  protected readonly serviceName = LEGAL.serviceName;
  protected readonly lastUpdated = LEGAL.lastUpdated;
  protected readonly missing = MISSING_LEGAL_FACTS;

  protected readonly documents = [
    { path: 'privacy', label: 'Privacy Policy' },
    { path: 'terms', label: 'Terms of Use' },
    { path: 'cookies', label: 'Cookies & Storage' },
  ] as const;
}
