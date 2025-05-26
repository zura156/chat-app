import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './features/auth/interceptors/auth.interceptor';
import { refreshTokenInterceptor } from './features/auth/interceptors/refresh-token.interceptor';
import { provideToastr } from 'ngx-toastr';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideToastr({
      timeOut: 5000,
      titleClass: 'text-lg font-medium',
      positionClass: 'toast-bottom-right',
      preventDuplicates: true,
    }),
    provideHttpClient(
      withInterceptors([authInterceptor, refreshTokenInterceptor])
    ),
  ],
};
