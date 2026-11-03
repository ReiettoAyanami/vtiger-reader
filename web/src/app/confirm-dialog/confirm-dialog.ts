import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Observable } from 'rxjs';

import { ApiError } from '../data/api-error';

/** What the confirmation asks and does. */
export interface ConfirmDialogData {
  title: string;
  message: string;
  /** The label of the button that confirms, e.g. "Delete". */
  confirm: string;
  /** A destructive action (the default): the button in the error colour. Signing out is not one. */
  destructive?: boolean;
  /** What confirming does (a request): the dialog waits for it, closes on success, says why on a failure. */
  action: () => Observable<unknown>;
}

/**
 * Asks before an action and runs it (design-frontend.md, consumption card: Delete; the sidebar's
 * Sign out, lenzi 2026-10-03).
 * Closes with `true` once the action succeeded, with nothing on Cancel; on an error it stays open
 * and says why (e.g. the API's 409 on a consumption of a finished batch).
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.css',
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject<MatDialogRef<ConfirmDialog, true>>(MatDialogRef);

  /** The action is running: the button is disabled (no double submit). */
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);

  protected confirm(): void {
    // The guard, not only the disabled button: a second tap can arrive before the view updates.
    if (this.running()) return;
    this.running.set(true);
    this.error.set(null);
    this.data.action().subscribe({
      next: () => this.dialog.close(true),
      error: (error: ApiError) => {
        this.running.set(false);
        this.error.set(`${error.detail || error.title}${error.status ? ` (${error.status})` : ''}`);
      },
    });
  }

  protected cancel(): void {
    this.dialog.close();
  }
}
