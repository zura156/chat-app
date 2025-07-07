// theme.service.ts
import { Injectable, Renderer2, RendererFactory2 } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ThemesT } from '../interfaces/themes.type';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private renderer: Renderer2;
  private themeMode = new BehaviorSubject<ThemesT>('dark');
  themeMode$ = this.themeMode.asObservable();

  constructor(rendererFactory: RendererFactory2) {
    this.renderer = rendererFactory.createRenderer(null, null);
    try {
      const storedTheme = localStorage.getItem('darkMode');

      if (storedTheme) {
        // User has explicit preference
        this.setDarkMode(storedTheme as 'dark' | 'light');
      } else {
        // Use system preference
        const prefersDark = window.matchMedia(
          '(prefers-color-scheme: dark)'
        ).matches;
        this.setDarkMode(prefersDark ? 'dark' : 'light');
      }
    } catch (error) {
      // Fallback if localStorage is not available
      console.warn('localStorage not available, using light mode');
      this.setDarkMode('light');
    }
    // ! WILL CHANGE THIS LATER IF MORE THEME TYPES ARE ADDED !
    // Check for saved preference or use system preference
    // const isDarkMode =
    //   localStorage.getItem('darkMode') === 'dark' ||
    //   (!localStorage.getItem('darkMode') &&
    //     window.matchMedia('(prefers-color-scheme: dark)').matches);

    // this.setDarkMode(isDarkMode ? 'dark' : 'light');
  }

  setDarkMode(theme: ThemesT): void {
    this.themeMode.next(theme);

    if (theme === 'dark') {
      this.renderer.addClass(document.documentElement, 'dark');
      localStorage.setItem('darkMode', 'dark');
    } else {
      this.renderer.removeClass(document.documentElement, 'dark');
      localStorage.setItem('darkMode', 'light');
    }
  }

  switchTheme(): void {
    this.setDarkMode(this.themeMode.value === 'dark' ? 'light' : 'dark');
  }
}
