import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';

import { Session } from './session';

/**
 * The admin view (design-accounts.md, "Web: /<username>/admin"): for an administrator acting as
 * itself. A user, or anyone during an impersonation, gets no match, so the address answers like one
 * that does not exist (the 404 page), as the API's admin routes do. It sits under `:username`, whose
 * guard already sent a signed-out browser to the sign-in page and let only the user's own pages in.
 */
export const adminGuard: CanMatchFn = async () => {
  const session = inject(Session);
  await session.load();
  return session.canAdminister();
};
