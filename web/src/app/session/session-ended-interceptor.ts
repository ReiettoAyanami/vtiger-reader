import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { Session } from './session';

/**
 * A call to the API answered 401: the session is over (signed out from another device, expired,
 * the account blocked). The app forgets it and goes to the sign-in page, which comes back here
 * afterwards. The sign-in endpoints answer 401 for a wrong password: that is the sign-in page's
 * business, not a session that ended. A page asks for several things at once, so several 401s
 * arrive together: only the first one, the one that still finds the user, goes to the sign-in page.
 */
export const sessionEndedInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(Session);
  const router = inject(Router);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !req.url.startsWith('/api/auth/')) {
        const first = session.user() !== null;
        session.forget();
        if (first && !router.url.startsWith('/login')) {
          void router.navigateByUrl(router.createUrlTree(['/login'], { queryParams: { next: router.url } }));
        }
      }
      return throwError(() => error);
    }),
  );
};
