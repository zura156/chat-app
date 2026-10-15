import {
  ApplicationConfig,
  DOCUMENT,
  inject,
  provideAppInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './features/auth/interceptors/auth.interceptor';
import { httpOptionsInterceptor } from './features/auth/interceptors/http-options.interceptor';
import { AuthService } from './features/auth/services/auth.service';
import { CSRFService } from './features/auth/services/csrf.service';
import { provideLoadingBarRouter } from '@ngx-loading-bar/router';
import { firstValueFrom } from 'rxjs';

const MAX_DEPTH = 2; // 0 = root outlet, 1 = child outlet, 2 = grandchild outlet

const urlKey = (s: ActivatedRouteSnapshot | null) =>
  s ? s.url.map((u) => u.path).join('/') : '';

/** depth where old/new routes first differ (route or path segments); -1 if identical */
function divergenceDepth(
  from: ActivatedRouteSnapshot,
  to: ActivatedRouteSnapshot,
): number {
  let a: ActivatedRouteSnapshot | null = from.root.firstChild;
  let b: ActivatedRouteSnapshot | null = to.root.firstChild;
  let depth = 0;
  while (a || b) {
    if (a?.routeConfig !== b?.routeConfig || urlKey(a) !== urlKey(b))
      return depth;
    a = a?.firstChild ?? null;
    b = b?.firstChild ?? null;
    depth++;
  }
  return -1;
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      withViewTransitions({
        onViewTransitionCreated: ({ transition, from, to }) => {
          const html = inject(DOCUMENT).documentElement;
          const depth = divergenceDepth(from, to);
          if (depth < 0 || depth > MAX_DEPTH) {
            transition.skipTransition();
            return;
          }
          html.dataset['vt'] = String(depth);
          transition.finished.finally(() => delete html.dataset['vt']);
        },
      }),
    ),
    provideZonelessChangeDetection(),
    provideHttpClient(
      withInterceptors([httpOptionsInterceptor, authInterceptor]),
    ),

    provideAppInitializer(async () => {
      const csrf = inject(CSRFService);
      const auth = inject(AuthService);

      await firstValueFrom(csrf.ensureToken()).catch(() => null);

      auth.init();
    }),

    provideLoadingBarRouter(),
  ],
};
