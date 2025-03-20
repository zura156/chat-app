// theme.service.ts
import { Injectable, Renderer2, RendererFactory2 } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private renderer: Renderer2;
  private darkMode = new BehaviorSubject<boolean>(false);
  darkMode$ = this.darkMode.asObservable();

  constructor(rendererFactory: RendererFactory2) {
    this.renderer = rendererFactory.createRenderer(null, null);

    // Check for saved preference or use system preference
    const isDarkMode =
      localStorage.getItem('darkMode') === 'dark' ||
      (!localStorage.getItem('darkMode') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);

    this.setDarkMode(isDarkMode);
  }

  setDarkMode(isDarkMode: boolean): void {
    this.darkMode.next(isDarkMode);

    if (isDarkMode) {
      this.renderer.addClass(document.documentElement, 'dark');
      localStorage.setItem('darkMode', 'dark');
    } else {
      this.renderer.removeClass(document.documentElement, 'dark');
      localStorage.setItem('darkMode', 'light');
    }
  }

  toggleDarkMode(): void {
    this.setDarkMode(!this.darkMode.value);
  }
}
