import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Session } from './session';

/** The sign-in page, for those not signed in; the others go to their own pages. */
export const signedOutGuard: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  const user = await session.load();
  return user ? router.createUrlTree(['/', user.username]) : true;
};
