import {
  computed,
  effect,
  Injectable,
  Renderer2,
  RendererFactory2,
  signal,
} from '@angular/core';

export type Theme = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private renderer: Renderer2;

  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  theme = signal<Theme>(this.getSavedTheme());
  colorTheme = signal<string>(localStorage.getItem('colorTheme') ?? 'mono');

  private systemPrefersDark = signal<boolean>(this.mediaQuery.matches);

  isDarkMode = computed(() => {
    const currentTheme = this.theme();
    if (currentTheme === 'system') {
      return this.systemPrefersDark();
    }
    return currentTheme === 'dark';
  });

  constructor(rendererFactory: RendererFactory2) {
    this.renderer = rendererFactory.createRenderer(null, null);

    this.mediaQuery.addEventListener('change', (e) => {
      this.systemPrefersDark.set(e.matches);
    });
    effect(() => {
      const isDark = this.isDarkMode();
      if (isDark) {
        this.renderer.addClass(document.documentElement, 'dark');
      } else {
        this.renderer.removeClass(document.documentElement, 'dark');
      }
    });

    this.setColorTheme(this.colorTheme());
  }

  setTheme(theme: Theme, colorTheme?: string): void {
    if (!document.startViewTransition) {
      this.theme.set(theme);
      localStorage.setItem('theme', theme);
      this.applyTheme(theme);
      return;
    }

    document.startViewTransition(async () => {
      this.theme.set(theme);
      localStorage.setItem('theme', theme);

      this.applyTheme(theme);
      if (colorTheme) this.setColorTheme(colorTheme);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  toggle(): void {
    this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
  }

  private applyTheme(theme: Theme): void {
    if (theme === 'dark') {
      this.toggleDark(true);
    } else if (theme === 'light') {
      this.toggleDark(false);
    } else {
      const prefersDark = this.mediaQuery.matches;
      this.toggleDark(prefersDark);
    }
  }

  private toggleDark(dark: boolean): void {
    if (dark) {
      this.renderer.addClass(document.documentElement, 'dark');
    } else {
      this.renderer.removeClass(document.documentElement, 'dark');
    }
  }

  setColorTheme(colorTheme: string): void {
    this.colorTheme.set(colorTheme);
    localStorage.setItem('colorTheme', colorTheme);
    if (colorTheme === 'mono') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', colorTheme);
    }
  }

  private getSavedTheme(): Theme {
    try {
      return (localStorage.getItem('theme') as Theme) ?? 'system';
    } catch {
      return 'system';
    }
  }
}
