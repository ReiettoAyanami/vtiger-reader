import { Location } from '@angular/common';
import { ComponentType } from '@angular/cdk/portal';
import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { NavigationStart, Router } from '@angular/router';

/** Marks the history entry pushed while a dialog is open. */
interface DialogHistoryState {
  dialog?: true;
}

/** An address without its query and fragment: the page it shows. */
const pageOf = (url: string) => url.split(/[?#]/)[0] ?? url;

/**
 * Opens a Material dialog with its own history entry (from substance-tracker), so the browser's back, also the phone's back gesture, closes the dialog
 * and stays where it was: MatDialog closes on that back (closeOnNavigation). Closed any other way,
 * the entry is removed. The URL never changes, except through a link in the dialog to another page
 * (a details window's "choose the metrics"): then the dialog closes and the new page takes the place
 * of its entry, so back returns to the page that was under it (lenzi, 2026-10-03).
 */
@Injectable({
  providedIn: 'root',
})
export class HistoryDialogs {
  private readonly dialog = inject(MatDialog);
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  /**
   * Resolves with the dialog's result once its history entry is gone: a page that reads the
   * history state when it closes reads the right one.
   */
  open<C, D, R>(component: ComponentType<C>, data: D, config: MatDialogConfig<D> = {}): Promise<R | undefined> {
    const ref = this.dialog.open<C, D, R>(component, {
      width: '560px',
      maxWidth: 'calc(100vw - 32px)',
      ...config,
      data,
    });
    const page = this.location.path();
    this.location.go(page, '', { dialog: true } satisfies DialogHistoryState);

    // A navigation to another page while the dialog is open: done again in place of the dialog's
    // entry, and the dialog closes. A back (popstate) and a change of the same page's query do not
    // count.
    let leftForAnotherPage = false;
    const navigations = this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationStart) || event.navigationTrigger === 'popstate') return;
      if (pageOf(event.url) === pageOf(page)) return;
      leftForAnotherPage = true;
      navigations.unsubscribe();
      const extras = this.router.currentNavigation()?.extras;
      void this.router.navigateByUrl(event.url, { state: extras?.state, info: extras?.info, replaceUrl: true });
      ref.close();
    });

    return new Promise((resolve) => {
      ref.afterClosed().subscribe((result) => {
        navigations.unsubscribe();
        // Left for another page (its entry is replaced) or closed by a back (gone already).
        if (leftForAnotherPage || !(this.location.getState() as DialogHistoryState | null)?.dialog) {
          resolve(result);
          return;
        }
        const popped = this.location.subscribe(() => {
          popped.unsubscribe();
          // The router takes a back in a later task (a setTimeout of its own, queued just before this
          // one): resolving after it, a navigation the caller starts at once is not cancelled by that
          // back. Signed out, the app stayed on the page instead of the sign-in one (lenzi, 2026-10-03).
          setTimeout(() => resolve(result));
        });
        this.location.back();
      });
    });
  }
}
