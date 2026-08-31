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
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
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
