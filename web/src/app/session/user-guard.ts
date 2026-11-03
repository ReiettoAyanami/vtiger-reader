import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { Session } from './session';

/**
 * The pages under `/<username>/` (design-accounts.md, "Web: /<username>/"): only the signed-in
 * user's own. Signed out: the sign-in page, which comes back here afterwards. Another username: the
 * route does not match, so the address answers like one that does not exist (the 404 page): a user
 * never learns that another one exists.
 */
export const userGuard: CanMatchFn = async (_route, segments) => {
  const session = inject(Session);
  const router = inject(Router);
  const user = await session.load();
  if (!user) {
    const next = router.currentNavigation()?.extractedUrl.toString() ?? `/${segments.map((s) => s.path).join('/')}`;
    return router.createUrlTree(['/login'], { queryParams: { next } });
  }
  return segments[0]?.path === user.username;
};
