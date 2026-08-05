import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './features/auth/interceptors/auth.interceptor';
import { httpOptionsInterceptor } from './features/auth/interceptors/http-options.interceptor';
import { AuthService } from './features/auth/services/auth.service';
import { CSRFService } from './features/auth/services/csrf.service';
import { provideLoadingBarRouter } from '@ngx-loading-bar/router';
import { firstValueFrom } from 'rxjs';

export const appConfig: ApplicationConfig = {
  providers: [
    /*
     * No `withPreloading(PreloadAllModules)`.
     *
     * It downloaded every lazy route immediately after the initial render,
     * which is most of the point of splitting them gone: a user who only ever
     * opens the chat still paid for settings, the user page and the whole auth
     * feature. The router's default (load on navigation) is the right trade for
     * an app this size; individual routes can opt into preloading if a specific
     * one proves worth it.
     */
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
    ),

    /*
     * Zoneless: state here is held in signals, which schedule change detection
     * themselves, so zone.js was patching every timer, event and XHR to trigger
     * work that signals were already driving.
     *
     * The catch, and it is worth knowing before adding a component: a value the
     * template reads must be a signal, or be written during something that
     * already schedules a pass (a template event binding, an async pipe). A
     * plain property mutated inside a `setTimeout`, a promise callback or an
     * `addEventListener` handler will change without the view noticing. The
     * audio recorder rendered off `mediaRecorder.state` this way and only
     * repainted when an unrelated signal happened to tick.
     */
    provideZonelessChangeDetection(),

    /*
     * `withXsrfConfiguration` is deliberately absent. Angular's built-in XSRF
     * interceptor only attaches the header to same-origin relative URLs, and
     * every request here goes to an absolute cross-origin `apiUrl` — so it was
     * configured, inert, and easy to mistake for the thing actually doing the
     * work. `httpOptionsInterceptor` sets the header explicitly.
     */
    provideHttpClient(
      withInterceptors([httpOptionsInterceptor, authInterceptor]),
    ),

    provideAppInitializer(async () => {
      const csrf = inject(CSRFService);
      const auth = inject(AuthService);

      // Before anything can be posted — login included — the client needs a
      // CSRF token to echo back. Failure is non-fatal: the app still boots and
      // the interceptor retries on demand.
      await firstValueFrom(csrf.ensureToken()).catch(() => null);

      auth.init();
    }),

    provideLoadingBarRouter(),
  ],
};
