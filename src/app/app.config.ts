import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import {
  PreloadAllModules,
  provideRouter,
  withPreloading,
} from '@angular/router';
import { routes } from './app.routes';
import {
  provideHttpClient,
  withInterceptors,
  withXsrfConfiguration,
} from '@angular/common/http';
import { authInterceptor } from './features/auth/interceptors/auth.interceptor';
import { httpOptionsInterceptor } from './features/auth/interceptors/http-options.interceptor';
import { AuthService } from './features/auth/services/auth.service';
import { provideLoadingBarRouter } from '@ngx-loading-bar/router';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(
      withInterceptors([httpOptionsInterceptor, authInterceptor]),
      withXsrfConfiguration({
        cookieName: 'csrfToken',
        headerName: 'X-CSRF-TOKEN',
      }),
    ),
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      return auth.init();
    }),
    provideLoadingBarRouter(),
  ],
};
