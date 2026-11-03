import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';

import { User } from '../data/user';
import { UserForm } from '../user-form/user-form';

/** What the entity dialog creates or edits: one form per entity. Users only, for now. */
export type EntityKind = 'user';

const KIND_LABELS: Record<EntityKind, string> = { user: 'User' };

/** What the dialog opens with. */
export interface EntityDialogData {
  /** The kinds it offers for a new record; more than one → a "New" selector on top. */
  kinds: readonly EntityKind[];
  /** The kind shown first; the first of `kinds` when missing. */
  kind?: EntityKind;
  /** A record to edit: only its form, filled in, no selector. */
  edit?: { kind: 'user'; user: User };
}

/** What it closes with: the saved record and its kind. Nothing when cancelled or closed by back. */
export type EntityDialogResult = { kind: 'user'; user: User };

/**
 * The one dialog that hosts the entity forms, as in substance-tracker. The forms do not know who
 * opened them; this dialog only chooses which one to show and closes with what it saved. The URL
 * never changes: the history entry that lets back close it belongs to whoever opens it
 * (HistoryDialogs). Adding a kind is adding its form here.
 */
@Component({
  selector: 'app-entity-dialog',
  imports: [MatDialogModule, MatFormFieldModule, MatSelectModule, UserForm],
  templateUrl: './entity-dialog.html',
  styleUrl: './entity-dialog.css',
})
export class EntityDialog {
  protected readonly data = inject<EntityDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject<MatDialogRef<EntityDialog, EntityDialogResult>>(MatDialogRef);

  protected readonly kind = signal<EntityKind>(this.data.edit?.kind ?? this.data.kind ?? this.data.kinds[0]!);
  /** A new record of more than one kind: the selector stands in for the forms' titles. */
  protected readonly chooser = !this.data.edit && this.data.kinds.length > 1;
  protected readonly labels = KIND_LABELS;

  /** The record to edit, by its kind. */
  protected readonly editedUser = this.data.edit?.kind === 'user' ? this.data.edit.user : null;

  protected savedUser(user: User): void {
    this.dialog.close({ kind: 'user', user });
  }

  protected cancel(): void {
    this.dialog.close();
  }
}
