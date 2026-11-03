import { Component, ElementRef, inject, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { IsActiveMatchOptions, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { from } from 'rxjs';

import { ConfirmDialog, ConfirmDialogData } from '../confirm-dialog/confirm-dialog';
import { HistoryDialogs } from '../history-dialogs';
import { Session } from '../session/session';

const ROOT: IsActiveMatchOptions = { paths: 'exact', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored' };
const SUBTREE: IsActiveMatchOptions = { paths: 'subset', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored' };

/**
 * The navigation between the pages, as in substance-tracker: the app's name and the signed-in username, one link per page of the user, the
 * current one highlighted (also on a child route, e.g. a ticket's page), then at the bottom,
 * apart from the pages, "Admin" (administrators acting as themselves only), "Sign out" and the
 * settings. The app shell hosts it in a drawer.
 */
@Component({
  selector: 'app-sidebar',
  imports: [MatIconModule, MatListModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  /** A link was tapped (or the user signed out): the shell closes the drawer. */
  readonly navigated = output<void>();

  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly dialogs = inject(HistoryDialogs);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * The user's pages, under their root. The start page is the root itself: highlighted on the root
   * only (whatever its filter), the others also on their child routes.
   */
  protected readonly pages = [
    { path: '', label: 'Tickets', icon: 'confirmation_number', match: ROOT },
  ] as const;
  protected readonly settingsMatch = SUBTREE;

  /**
   * Asks first (lenzi, 2026-10-03: "sign out ha bisogno di una richiesta di conferma"). The dialog
   * signs out and says why when the server did not take it (still signed in, then).
   */
  protected async signOut(): Promise<void> {
    const signedOut = await this.dialogs.open<ConfirmDialog, ConfirmDialogData, true>(
      ConfirmDialog,
      {
        title: 'Sign out?',
        message: 'You will have to sign in again on this device.',
        confirm: 'Sign out',
        destructive: false,
        action: () => from(this.session.signOut()),
      },
      // Not back on "Sign out": a focused entry is drawn highlighted, and after Cancel it stayed so
      // (substance-tracker, lenzi 2026-10-03). The focus goes to the current page's entry.
      { width: '400px', restoreFocus: false },
    );
    if (!signedOut) {
      this.host.nativeElement.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
      return;
    }
    this.navigated.emit();
    await this.router.navigateByUrl('/login');
  }
}
