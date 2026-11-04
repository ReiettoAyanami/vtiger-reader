import { Component, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';

const ROOT: IsActiveMatchOptions = { paths: 'exact', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored' };
const SUBTREE: IsActiveMatchOptions = { paths: 'subset', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored' };

/**
 * The navigation between the pages, as in substance-tracker: the app's name, one link per page, the
 * current one highlighted (also on a child route, e.g. a ticket's page), then at the bottom, apart
 * from the pages, the settings. The app shell hosts it in a drawer. No accounts, no sign-out: the
 * desktop app has one profile (plan 7.1).
 */
@Component({
  selector: 'app-sidebar',
  imports: [MatIconModule, MatListModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  /** A link was tapped: the shell closes the drawer. */
  readonly navigated = output<void>();

  /**
   * The pages. The start page is the root itself: highlighted on the root only (whatever its
   * filter), the others also on their child routes.
   */
  protected readonly pages = [{ path: '/', label: 'Tickets', icon: 'confirmation_number', match: ROOT }] as const;
  protected readonly settingsMatch = SUBTREE;
}
