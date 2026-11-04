import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { errorInterceptor } from './data/error-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Route parameters arrive as component inputs.
    provideRouter(routes, withComponentInputBinding()),
    // Every failure becomes an ApiError.
    provideHttpClient(withFetch(), withInterceptors([errorInterceptor])),
    // Windows open and close a little slower than Material's 150 / 75 ms, as in substance-tracker;
    // the closing fade of styles.css ("glass") lasts the same 150 ms.
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: { ...new MatDialogConfig(), enterAnimationDuration: '250ms', exitAnimationDuration: '150ms' },
    },
  ],
};
