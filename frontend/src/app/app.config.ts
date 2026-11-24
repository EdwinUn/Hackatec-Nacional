import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { HttpRioApi } from './core/api/http-rio-api';
import { RioApi } from './core/api/rio-api';
import { APP_CONFIG } from './core/config/app-config';
import { apiErrorInterceptor } from './core/interceptors/api-error.interceptor';
import { MockRioApi } from './core/mock/mock-rio-api';

/** Forest-green palette on a light canvas. */
const RioPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{emerald.50}', 100: '{emerald.100}', 200: '{emerald.200}', 300: '{emerald.300}', 400: '{emerald.400}',
      500: '{emerald.500}', 600: '{emerald.600}', 700: '{emerald.700}', 800: '{emerald.800}', 900: '{emerald.900}', 950: '{emerald.950}',
    },
    colorScheme: {
      light: { primary: { color: '#1f7a5a', hoverColor: '#17634a', activeColor: '#112a22' } },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([apiErrorInterceptor])),
    providePrimeNG({
      ripple: true,
      ...(environment.primeLicense ? { license: environment.primeLicense } : {}),
      theme: { preset: RioPreset, options: { darkModeSelector: false, cssLayer: false } },
    }),
    MessageService,
    HttpRioApi,
    MockRioApi,
    { provide: RioApi, useFactory: () => (inject(APP_CONFIG).useMocks ? inject(MockRioApi) : inject(HttpRioApi)) },
  ],
};
