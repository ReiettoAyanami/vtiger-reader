import { Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

import { User } from '../../data/user';
import { LOCALE } from '../../locale';

const CREATED = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * One user in the admin view (design-accounts.md, "Web: /<username>/admin"): username, email, role, created,
 * status. Its ⋮ menu asks the page to edit, impersonate or delete the user; the signed-in
 * administrator's own card has no menu (an administrator never acts on itself) and says "You".
 */
@Component({
  selector: 'app-user-card',
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatMenuModule],
  templateUrl: './user-card.html',
  styleUrl: './user-card.css',
})
export class UserCard {
  readonly user = input.required<User>();
  /** The signed-in administrator's own card. */
  readonly self = input(false);

  readonly edit = output<void>();
  readonly impersonate = output<void>();
  readonly remove = output<void>();

  protected readonly created = computed(() => `Created ${CREATED.format(new Date(this.user().createdAt))}`);
}
