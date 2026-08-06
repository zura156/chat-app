import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeService } from './theme.service';

/*
 * Light/dark and the accent palette.
 *
 * Appearance is a *device* preference, not part of the session — signing out
 * used to reset it, because clearAppState called localStorage.clear(). That is
 * fixed on the auth side; what is pinned here is the other half: the class on
 * <html> is driven by a single effect off one signal, so there is exactly one
 * mechanism to keep in step. An earlier version also applied the theme by hand
 * in setTheme, which meant two code paths for one piece of state and either
 * could be updated without the other.
 */

/** Lets a test decide what the OS reports, before the service is constructed. */
const stubMatchMedia = (prefersDark: boolean) => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: prefersDark,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (
        _: string,
        listener: (e: MediaQueryListEvent) => void,
      ) => listeners.delete(listener),
    })),
  );

  /** Simulates the user switching their OS appearance while the app is open. */
  return (matches: boolean) =>
    listeners.forEach((listener) =>
      listener({ matches } as MediaQueryListEvent),
    );
};

const build = () => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
  const service = TestBed.inject(ThemeService);
  TestBed.tick(); // flush the effect that writes the class
  return service;
};

const isDarkOnDocument = () =>
  document.documentElement.classList.contains('dark');

describe('ThemeService', () => {
  let emitSystemChange: (matches: boolean) => void;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');
    emitSystemChange = stubMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');
  });

  describe('choosing a theme', () => {
    it('follows the system by default', () => {
      // Not "light": defaulting to a fixed theme means a user whose OS is dark
      // gets a white flash on first load.
      expect(build().theme()).toBe('system');
    });

    it('restores the saved choice', () => {
      localStorage.setItem('theme', 'dark');
      expect(build().theme()).toBe('dark');
    });

    it('remembers a change across a restart', () => {
      build().setTheme('light');
      expect(localStorage.getItem('theme')).toBe('light');

      emitSystemChange = stubMatchMedia(true);
      expect(build().theme()).toBe('light');
    });

    it('toggles between light and dark', () => {
      const service = build();
      service.setTheme('dark');

      service.toggle();
      expect(service.theme()).toBe('light');

      service.toggle();
      expect(service.theme()).toBe('dark');
    });

    it('leaves "system" for dark on the first toggle', () => {
      // `system` is neither, so the toggle has to pick something; going to
      // dark first is what the button's icon promises.
      const service = build();
      expect(service.theme()).toBe('system');

      service.toggle();
      expect(service.theme()).toBe('dark');
    });
  });

  describe('resolving to light or dark', () => {
    it('reads the OS preference while set to system', () => {
      emitSystemChange = stubMatchMedia(true);
      expect(build().isDarkMode()).toBe(true);

      emitSystemChange = stubMatchMedia(false);
      expect(build().isDarkMode()).toBe(false);
    });

    it('ignores the OS once the user has chosen', () => {
      // An explicit choice is an override, not a hint.
      emitSystemChange = stubMatchMedia(true);
      const service = build();

      service.setTheme('light');
      expect(service.isDarkMode()).toBe(false);
    });

    it('follows the OS changing while the app is open', () => {
      /*
       * The listener, not just the initial read. Someone on a schedule that
       * flips their machine to dark at sunset is sitting in a light app until
       * they reload without this.
       */
      const service = build();
      expect(service.isDarkMode()).toBe(false);

      emitSystemChange(true);
      expect(service.isDarkMode()).toBe(true);

      emitSystemChange(false);
      expect(service.isDarkMode()).toBe(false);
    });

    it('does not follow the OS after an explicit choice', () => {
      const service = build();
      service.setTheme('light');

      emitSystemChange(true);

      expect(service.isDarkMode()).toBe(false);
    });

    it('follows the OS again when set back to system', () => {
      const service = build();
      service.setTheme('dark');
      emitSystemChange(false);
      expect(service.isDarkMode()).toBe(true);

      service.setTheme('system');
      expect(service.isDarkMode()).toBe(false);

      emitSystemChange(true);
      expect(service.isDarkMode()).toBe(true);
    });
  });

  describe('the class on the document', () => {
    it('is applied on start-up, not only on a change', () => {
      // Tailwind's dark variants key off this class; without it on boot the
      // first paint is light regardless of the setting.
      localStorage.setItem('theme', 'dark');
      build();

      expect(isDarkOnDocument()).toBe(true);
    });

    it('is added and removed as the theme changes', () => {
      const service = build();
      expect(isDarkOnDocument()).toBe(false);

      service.setTheme('dark');
      TestBed.tick();
      expect(isDarkOnDocument()).toBe(true);

      service.setTheme('light');
      TestBed.tick();
      expect(isDarkOnDocument()).toBe(false);
    });

    it('follows the OS without the theme setting changing', () => {
      /*
       * The single-mechanism property. The class comes from the `isDarkMode`
       * computed, so anything that moves it — including an OS change with the
       * setting left on `system` — updates the document. A setTheme that also
       * applied the class by hand would miss exactly this path.
       */
      const service = build();
      expect(isDarkOnDocument()).toBe(false);

      emitSystemChange(true);
      TestBed.tick();

      expect(service.theme()).toBe('system');
      expect(isDarkOnDocument()).toBe(true);
    });
  });

  describe('the accent palette', () => {
    it('defaults to mono', () => {
      expect(build().colorTheme()).toBe('mono');
    });

    it('sets an attribute for a named palette', () => {
      const service = build();
      service.setColorTheme('blue');

      expect(document.documentElement.getAttribute('data-theme')).toBe('blue');
      expect(service.colorTheme()).toBe('blue');
    });

    it('removes the attribute for mono rather than setting it', () => {
      // The stylesheet's defaults live on the bare `:root`; leaving
      // `data-theme="mono"` in place would need a rule that does not exist.
      const service = build();
      service.setColorTheme('blue');

      service.setColorTheme('mono');

      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });

    it('is applied on start-up from storage', () => {
      localStorage.setItem('colorTheme', 'green');
      const service = build();

      expect(service.colorTheme()).toBe('green');
      expect(document.documentElement.getAttribute('data-theme')).toBe('green');
    });

    it('can be changed alongside the theme in one call', () => {
      const service = build();
      service.setTheme('dark', 'blue');
      TestBed.tick();

      expect(service.theme()).toBe('dark');
      expect(service.colorTheme()).toBe('blue');
      expect(isDarkOnDocument()).toBe(true);
    });

    it('is left alone when setTheme is called without one', () => {
      const service = build();
      service.setColorTheme('blue');

      service.setTheme('dark');

      expect(service.colorTheme()).toBe('blue');
    });

    it('is remembered separately from the theme', () => {
      // They are two preferences; changing one must not reset the other.
      const service = build();
      service.setTheme('dark');
      service.setColorTheme('green');

      emitSystemChange = stubMatchMedia(false);
      const restarted = build();

      expect(restarted.theme()).toBe('dark');
      expect(restarted.colorTheme()).toBe('green');
    });
  });

  describe('when localStorage is unavailable', () => {
    /*
     * Safari's private mode and some enterprise policies make localStorage
     * throw on access. The reads are guarded — an unguarded read in a root
     * service's constructor takes the whole app down with a blank screen on
     * exactly one browser configuration, which is the kind of bug that only
     * ever arrives as an unreproducible report.
     */

    it('starts up on defaults rather than failing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied');
      });

      const service = build();

      expect(service.theme()).toBe('system');
      expect(service.colorTheme()).toBe('mono');
    });

    it('guards both preferences, not just the theme', () => {
      // The asymmetry that prompted the guard: `theme` was protected and
      // `colorTheme` was not, so only one browser configuration broke, and
      // only on the second read.
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
        if (key === 'colorTheme') throw new DOMException('denied');
        return 'dark';
      });

      const service = build();

      expect(service.theme()).toBe('dark');
      expect(service.colorTheme()).toBe('mono');
    });

    it('still applies the theme to the document', () => {
      // Losing the preference is tolerable; rendering an unstyled page is not.
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied');
      });
      emitSystemChange = stubMatchMedia(true);

      build();

      expect(isDarkOnDocument()).toBe(true);
    });

    it('throws when a preference is written, which the caller does not expect', () => {
      /*
       * Pinned as a known gap. `readStored` guards reads, but `setTheme` and
       * `setColorTheme` call `localStorage.setItem` directly — so on the same
       * browsers the app now boots on, changing the theme throws out of the
       * click handler. The signal is set first, so the appearance does change;
       * what breaks is anything sequenced after the call.
       */
      const service = build();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('denied');
      });

      expect(() => service.setColorTheme('blue')).toThrow();
      expect(service.colorTheme()).toBe('blue');
    });
  });
});
