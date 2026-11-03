import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../data/api-error';
import { ListFilter, TicketList } from '../../data/lists';
import { ListsApi } from '../../data/lists-api';
import { TicketOptions } from '../../data/tickets';

export interface ListDialogData {
  /** The list to edit; none: a new one. */
  list: TicketList | null;
  options: TicketOptions;
}

/** "me", "anyone", "groups" or "group:20x1": owner and group in one choice. */
export function ownerChoice(filter: ListFilter): string {
  return filter.owner === 'group' ? `group:${filter.group ?? ''}` : filter.owner;
}

/** "any", "open", "closed" or "one:Open": status and value in one choice. */
export function statusChoice(filter: ListFilter): string {
  return filter.status === 'one' ? `one:${filter.statusValue ?? ''}` : filter.status;
}

/** The filter the choices make. */
export function filterOf(owner: string, status: string, picks: Record<string, string>): ListFilter {
  const kept = Object.fromEntries(Object.entries(picks).filter(([, value]) => value));
  return {
    ...(owner.startsWith('group:')
      ? { owner: 'group' as const, group: owner.slice(6) }
      : { owner: owner as ListFilter['owner'] }),
    ...(status.startsWith('one:')
      ? { status: 'one' as const, statusValue: status.slice(4) }
      : { status: status as ListFilter['status'] }),
    ...(Object.keys(kept).length > 0 ? { picks: kept } : {}),
  };
}

/**
 * A list of the user's own, new or edited (lenzi, 2026-11-03: the lists "a relation to the user
 * itself", as the CRM's own "Liste"): its name, whose tickets, which status, and the ticket's other
 * picklists (category, support group, priority...), with the user's CRM's own values.
 */
@Component({
  selector: 'app-list-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  templateUrl: './list-dialog.html',
  styleUrl: './list-dialog.css',
})
export class ListDialog {
  private readonly api = inject(ListsApi);
  private readonly ref = inject<MatDialogRef<ListDialog, TicketList>>(MatDialogRef);
  protected readonly data = inject<ListDialogData>(MAT_DIALOG_DATA);

  private readonly start: ListFilter = this.data.list?.filter ?? { owner: 'me', status: 'open' };

  protected readonly form = new FormGroup({
    name: new FormControl(this.data.list?.name ?? '', { nonNullable: true }),
    owner: new FormControl(ownerChoice(this.start), { nonNullable: true }),
    status: new FormControl(statusChoice(this.start), { nonNullable: true }),
    picks: new FormGroup(
      Object.fromEntries(
        this.data.options.picklists.map((p) => [
          p.field,
          new FormControl(this.start.picks?.[p.field] ?? '', { nonNullable: true }),
        ]),
      ),
    ),
  });

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly nameError = signal<string | null>(null);

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const { name, owner, status, picks } = this.form.getRawValue();
    if (!name.trim()) {
      this.nameError.set('Required');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.nameError.set(null);
    const filter = filterOf(owner, status, picks as Record<string, string>);
    try {
      const saved = await firstValueFrom(
        this.data.list
          ? this.api.update(this.data.list.id, name.trim(), filter)
          : this.api.create(name.trim(), filter),
      );
      this.ref.close(saved);
    } catch (failure) {
      const problem = failure as ApiError;
      this.error.set(
        `Not saved: ${problem.fieldErrors?.[0]?.message || problem.detail || problem.title}`,
      );
    } finally {
      this.saving.set(false);
    }
  }
}
