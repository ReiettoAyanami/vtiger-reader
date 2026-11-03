import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Session } from './session';

/** The bare address: the signed-in user's own pages, or the sign-in page. */
export const homeGuard: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  const user = await session.load();
  return router.createUrlTree(user ? ['/', user.username] : ['/login']);
};
