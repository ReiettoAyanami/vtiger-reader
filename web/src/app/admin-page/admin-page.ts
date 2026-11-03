import { Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AdminApi } from '../data/admin-api';
import { ApiError } from '../data/api-error';
import { User } from '../data/user';
import { DeleteUserDialog } from '../delete-user-dialog/delete-user-dialog';
import { EntityDialog, EntityDialogData, EntityDialogResult } from '../entity-dialog/entity-dialog';
import { HistoryDialogs } from '../history-dialogs';
import { Session } from '../session/session';
import { AddButton } from '../ui/add-button/add-button';
import { UserCard } from '../ui/user-card/user-card';

/**
 * The admin view (design-accounts.md, "Web: /<username>/admin"): one card per user, the "+" to create one, and
 * each card's ⋮ menu to edit, impersonate or delete. The forms and dialogs do their own requests;
 * the list is asked again after each change. Impersonating opens the user's pages in this browser
 * (the "Viewing as" bar brings the administrator back here).
 */
@Component({
  selector: 'app-admin-page',
  imports: [AddButton, UserCard],
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.css',
})
export class AdminPage {
  private readonly api = inject(AdminApi);
  private readonly dialogs = inject(HistoryDialogs);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly users = rxResource({ stream: () => this.api.listUsers() });
  /** The signed-in administrator: its own card has no actions. */
  protected readonly selfId = computed(() => this.session.user()?.id ?? null);

  /** Why the list could not be loaded. The interceptor's ApiError is not an Error: the resource wraps it, as its cause. */
  protected readonly error = computed(() => {
    const failure = this.users.error();
    return failure ? ((failure.cause ?? failure) as Partial<ApiError>) : null;
  });

  protected async add(): Promise<void> {
    const result = await this.dialogs.open<EntityDialog, EntityDialogData, EntityDialogResult>(
      EntityDialog,
      { kinds: ['user'] },
      { ariaLabel: 'New user' },
    );
    if (result?.kind === 'user') this.users.reload();
  }

  protected async edit(user: User): Promise<void> {
    const result = await this.dialogs.open<EntityDialog, EntityDialogData, EntityDialogResult>(
      EntityDialog,
      { kinds: ['user'], edit: { kind: 'user', user } },
      { ariaLabel: `Edit ${user.username}` },
    );
    if (result?.kind === 'user') this.users.reload();
  }

  protected async remove(user: User): Promise<void> {
    const deleted = await this.dialogs.open<DeleteUserDialog, User, true>(DeleteUserDialog, user, { width: '420px' });
    if (deleted) this.users.reload();
  }

  /** This browser becomes the user's: their start page, with the "Viewing as" bar on top. */
  protected async impersonate(user: User): Promise<void> {
    try {
      await firstValueFrom(this.api.impersonate(user.id));
    } catch (error) {
      const problem = error as ApiError;
      this.snackBar.open(`Could not impersonate ${user.username}: ${problem.detail || problem.title}`, 'OK', { duration: 6000 });
      return;
    }
    await this.session.reload();
    await this.router.navigateByUrl(this.session.path());
  }
}
