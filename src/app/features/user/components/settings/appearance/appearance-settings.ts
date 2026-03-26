import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import {
  ThemeService,
  Theme,
} from '../../../../../shared/services/theme.service';

@Component({
  templateUrl: './appearance-settings.html',
  imports: [HlmSeparatorImports, HlmButtonImports, NgIcon, HlmIconImports],
  providers: [provideIcons({ lucideCheck })],
})
export class AppearanceSettings {
  private themeService = inject(ThemeService);

  selectedTheme = this.themeService.theme;
  selectedColorTheme = this.themeService.colorTheme;

  readonly modes = [
    { value: 'light' as Theme, label: 'Light' },
    { value: 'dark' as Theme, label: 'Dark' },
    { value: 'system' as Theme, label: 'System' },
  ];

  readonly colorThemes = [
    { value: 'mono', label: 'Mono', bg: '#f5f5f4', primary: '#1c1c1c' },
    {
      value: 'tokyo-night',
      label: 'Tokyo Night',
      bg: '#0f1117',
      primary: '#7aa2f7',
      isDarkOnly: true,
    },
    {
      value: 'catppuccin',
      label: 'Catppuccin',
      bg: '#24273a',
      primary: '#c6a0f6',
      isDarkOnly: true,
    },
    {
      value: 'parchment',
      label: 'Parchment',
      bg: '#fafaf8',
      primary: '#c87941',
    },
    { value: 'ocean', label: 'Ocean', bg: '#f0f4f8', primary: '#2563eb' },
    { value: 'rose', label: 'Rose', bg: '#f9f5f0', primary: '#d63b6e' },
    { value: 'sage', label: 'Sage', bg: '#f2f7f2', primary: '#16803c' },
  ];

  isDarkOnlyTheme = computed(() => {
    const currentThemeValue = this.selectedColorTheme();
    const activeTheme = this.colorThemes.find(
      (t) => t.value === currentThemeValue,
    );
    return activeTheme?.isDarkOnly ?? false;
  });

  setTheme(theme: Theme, colorTheme?: string) {
    this.themeService.setTheme(theme, colorTheme);
  }

  setColorTheme(colorTheme: string) {
    const themeObj = this.colorThemes.find((t) => t.value === colorTheme);
    const isDarkMode = this.themeService.isDarkMode();
    if (themeObj?.isDarkOnly && !isDarkMode) {
      this.setTheme('dark', colorTheme);
      return;
    }

    this.themeService.setColorTheme(colorTheme);
  }
}
