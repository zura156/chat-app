// MOCK COMPONENT.

import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';

type Theme = 'light' | 'dark' | 'system';
type Density = 'comfortable' | 'compact';

@Component({
  templateUrl: './appearance-settings.html',
  imports: [HlmSeparatorImports, HlmButtonImports, NgIcon, HlmIconImports],
  providers: [provideIcons({ lucideCheck })],
})
export class AppearanceSettings {
  selectedTheme = signal<Theme>(this.getSavedTheme());
  fontSize = signal<number>(this.getSavedFontSize());
  selectedDensity = signal<Density>(this.getSavedDensity());

  constructor() {
    this.watchSystemTheme();
    effect(() => {
      this.applyTheme(this.selectedTheme());
      localStorage.setItem('theme', this.selectedTheme());
    });

    effect(() => {
      document.documentElement.style.setProperty(
        '--font-size-base',
        `${this.fontSize()}px`,
      );
      localStorage.setItem('fontSize', String(this.fontSize()));
    });

    effect(() => {
      document.documentElement.setAttribute(
        'data-density',
        this.selectedDensity(),
      );
      localStorage.setItem('density', this.selectedDensity());
    });
  }

  setTheme(theme: string) {
    this.selectedTheme.set(theme as Theme);
  }

  setFontSize(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    this.fontSize.set(value);
  }

  setDensity(density: string) {
    this.selectedDensity.set(density as Density);
  }

  private applyTheme(theme: Theme) {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      // system
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches;
      root.classList.toggle('dark', prefersDark);
    }
  }

  private getSavedTheme(): Theme {
    return (localStorage.getItem('theme') as Theme) ?? 'system';
  }

  private getSavedFontSize(): number {
    return Number(localStorage.getItem('fontSize')) || 16;
  }

  private getSavedDensity(): Density {
    return (localStorage.getItem('density') as Density) ?? 'comfortable';
  }

  private watchSystemTheme() {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => {
        if (this.selectedTheme() === 'system') {
          document.documentElement.classList.toggle('dark', e.matches);
        }
      });
  }
}
