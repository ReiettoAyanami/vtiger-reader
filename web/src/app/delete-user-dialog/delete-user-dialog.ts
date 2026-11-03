import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { AdminApi } from '../data/admin-api';
import { ApiError } from '../data/api-error';
import { User } from '../data/user';

/**
 * Asks before deleting a user and deletes it (design-accounts.md, "delete (a user)": the one real
 * deletion; "the panel asks to type the username again"). Delete works only once the username is
 * typed again. Closes with `true` on the 204, with nothing on cancel; on an error it stays open and
 * says why.
 */
@Component({
  selector: 'app-delete-user-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  templateUrl: './delete-user-dialog.html',
  styleUrl: './delete-user-dialog.css',
})
export class DeleteUserDialog {
  private readonly api = inject(AdminApi);
  private readonly dialog = inject<MatDialogRef<DeleteUserDialog, true>>(MatDialogRef);
  protected readonly user = inject<User>(MAT_DIALOG_DATA);

  protected readonly typed = signal('');
  protected readonly confirmed = computed(() => this.typed().trim().toLowerCase() === this.user.username);

  /** The request is out: Delete is disabled (no double submit). */
  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected confirm(): void {
    // The guard, not only the disabled button: a second tap can arrive before the view updates.
    if (this.deleting() || !this.confirmed()) return;
    this.deleting.set(true);
    this.error.set(null);
    this.api.deleteUser(this.user.id).subscribe({
      next: () => this.dialog.close(true),
      error: (error: ApiError) => {
        this.deleting.set(false);
        this.error.set(`Could not delete: ${error.detail || error.title}${error.status ? ` (${error.status})` : ''}`);
      },
    });
  }

  protected cancel(): void {
    this.dialog.close();
  }
}
