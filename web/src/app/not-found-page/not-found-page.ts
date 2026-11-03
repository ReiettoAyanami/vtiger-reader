import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

import { Session } from '../session/session';

/**
 * An address that does not exist (design-accounts.md: "A username that is not the session's → the
 * 404 page, the same as an address that does not exist"): an old address, a typo, another user's
 * page all look the same. The way out: one's own start page, or the sign-in page.
 */
@Component({
  selector: 'app-not-found-page',
  imports: [MatButtonModule, RouterLink],
  templateUrl: './not-found-page.html',
  styleUrl: './not-found-page.css',
})
export class NotFoundPage {
  protected readonly session = inject(Session);
}
