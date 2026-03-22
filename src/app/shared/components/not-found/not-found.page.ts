import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import {
  lucideFileQuestion,
  lucideArrowLeft,
  lucideMessageCircle,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';

@Component({
  template: `
    <main
      class="flex min-h-dvh flex-col items-center justify-center px-6 text-center gap-y-6"
    >
      <div class="relative flex items-center justify-center select-none">
        <span
          class="text-[8rem] sm:text-[12rem] font-bold text-muted-foreground/60 leading-none tracking-tighter"
        >
          404
        </span>
        <div class="absolute flex flex-col items-center gap-y-1">
          <ng-icon
            hlm
            name="lucideFileQuestion"
            class="text-muted-foreground opacity-60"
            size="xl"
          />
        </div>
      </div>

      <div class="space-y-2 -mt-4">
        <h1 class="text-xl font-semibold tracking-tight">Page not found</h1>
        <p class="text-sm text-muted-foreground max-w-xs">
          The page you're looking for doesn't exist or has been moved.
        </p>
      </div>

      <div class="flex items-center gap-x-3">
        <a hlmBtn class="rounded-full cursor-pointer" [routerLink]="'/'">
          <ng-icon hlm name="lucideArrowLeft" size="sm" class="mr-1.5" />
          Go back
        </a>
      </div>
    </main>
  `,

  imports: [RouterLink, HlmButton, NgIconComponent, HlmIconImports],
  providers: [provideIcons({ lucideFileQuestion, lucideArrowLeft })],
})
export class NotFoundPage {}
