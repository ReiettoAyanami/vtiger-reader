import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { errorInterceptor } from './data/error-interceptor';
import { sessionEndedInterceptor } from './session/session-ended-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Route parameters arrive as component inputs.
    provideRouter(routes, withComponentInputBinding()),
    // The session check sits nearer the server: it sees the raw 401, then the error interceptor turns
    // every failure into an ApiError.
    provideHttpClient(withFetch(), withInterceptors([errorInterceptor, sessionEndedInterceptor])),
    // Windows open and close a little slower than Material's 150 / 75 ms, as in substance-tracker;
    // the closing fade of styles.css ("glass") lasts the same 150 ms.
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: { ...new MatDialogConfig(), enterAnimationDuration: '250ms', exitAnimationDuration: '150ms' },
    },
  ],
};
