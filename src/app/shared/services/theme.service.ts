import {
  computed,
  effect,
  Injectable,
  Renderer2,
  RendererFactory2,
  signal,
} from '@angular/core';

export type Theme = 'light' | 'dark' | 'system';

/**
 * localStorage throws in some privacy modes. `theme` already guarded for this
 * and `colorTheme` did not, which is the kind of asymmetry that turns into a
 * blank screen on exactly one browser configuration.
 */
const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private renderer: Renderer2;

  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  theme = signal<Theme>(this.getSavedTheme());
  colorTheme = signal<string>(readStored('colorTheme') ?? 'mono');

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

  /*
   * Only the signal is written. The `effect` in the constructor is what puts the
   * `dark` class on the document, so `applyTheme`/`toggleDark` existed purely to
   * do the same job a second time by hand — two mechanisms for one piece of
   * state, either of which could be updated without the other.
   */
  setTheme(theme: Theme, colorTheme?: string): void {
    const apply = () => {
      this.theme.set(theme);
      localStorage.setItem('theme', theme);
      if (colorTheme) this.setColorTheme(colorTheme);
    };

    if (!document.startViewTransition) {
      apply();
      return;
    }

    document.startViewTransition(async () => {
      apply();
      // Yields so the effect has flushed and the transition captures the new
      // appearance rather than the old one.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  toggle(): void {
    this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
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
    return (readStored('theme') as Theme) ?? 'system';
  }
}
