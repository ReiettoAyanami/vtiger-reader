import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ConfirmDialog, ConfirmDialogData } from '../../confirm-dialog/confirm-dialog';
import { ApiError } from '../../data/api-error';
import { CrmLinkApi } from '../../data/crm-link-api';
import { HistoryDialogs } from '../../history-dialogs';

function messageFor(errors: ValidationErrors | null): string | null {
  if (!errors) return null;
  if (errors['required']) return 'Required';
  if (errors['server']) return errors['server'];
  return null;
}

const required = (control: AbstractControl) =>
  String(control.value ?? '').trim() ? null : { required: true };

/**
 * The user's own CRM account (plan 2.2): not the app's sign-in, a second account the app works
 * with. The CRM's address is set here too, not in the server's .env (lenzi, 2026-11-03). The server
 * logs in with the three before saving them; the key is kept sealed on the server and never shown
 * again. While an administrator views the app as the user, the
 * link is only shown: it is the user's own.
 */
@Component({
  selector: 'app-crm-link-settings',
  imports: [
    DatePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  templateUrl: './crm-link-settings.html',
  styleUrl: './crm-link-settings.css',
})
export class CrmLinkSettings {
  private readonly api = inject(CrmLinkApi);
  private readonly dialogs = inject(HistoryDialogs);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly link = rxResource({ stream: () => this.api.getLink() });

  protected readonly failure = computed(() => {
    const failure = this.link.error();
    if (!failure) return null;
    const error = (failure.cause ?? failure) as Partial<ApiError>;
    return `Could not load the CRM account${error.status ? ` (${error.status})` : ''}`;
  });

  /** The CRM's host name, for the link to it. */
  protected readonly crmHost = computed(() => {
    const url = this.link.value()?.crmUrl;
    if (!url) return null;
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  });

  protected readonly form = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [required] }),
    username: new FormControl('', { nonNullable: true, validators: [required] }),
    accessKey: new FormControl('', { nonNullable: true, validators: [required] }),
  });

  /** "Change account" pressed on a linked account: the form shows, with Cancel. */
  protected readonly changing = signal(false);
  protected readonly keyShown = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected errorOf(field: keyof typeof this.form.controls): string | null {
    return messageFor(this.form.controls[field].errors);
  }

  protected startChange(): void {
    const link = this.link.value();
    this.form.reset({ url: link?.crmUrl ?? '', username: link?.username ?? '', accessKey: '' });
    this.formError.set(null);
    this.changing.set(true);
  }

  protected cancelChange(): void {
    this.changing.set(false);
    this.formError.set(null);
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { url, username, accessKey } = this.form.getRawValue();
    this.saving.set(true);
    this.formError.set(null);
    try {
      const saved = await firstValueFrom(
        this.api.link({ url: url.trim(), username: username.trim(), accessKey: accessKey.trim() }),
      );
      this.link.set(saved);
      this.form.reset({ url: '', username: '', accessKey: '' });
      this.keyShown.set(false);
      this.changing.set(false);
      this.snackBar.open(`CRM account linked: ${saved.username}`, undefined, { duration: 4000 });
    } catch (error) {
      this.showErrors(error as ApiError);
    } finally {
      this.saving.set(false);
    }
  }

  protected async unlink(): Promise<void> {
    const done = await this.dialogs.open<ConfirmDialog, ConfirmDialogData, true>(
      ConfirmDialog,
      {
        title: 'Unlink the CRM account?',
        message:
          'The saved access key is deleted. Tickets cannot be read until you link an account again.',
        confirm: 'Unlink',
        action: () => this.api.unlink(),
      },
      { width: '400px' },
    );
    if (!done) return;
    this.link.reload();
    this.snackBar.open('CRM account unlinked', undefined, { duration: 4000 });
  }

  /** The API's reasons under their field (a refused key under the key); anything else above the button. */
  private showErrors(error: ApiError): void {
    const controls: Record<string, AbstractControl | undefined> = this.form.controls;
    const unplaced = error.fieldErrors.filter((fieldError) => {
      const control = controls[fieldError.field];
      control?.setErrors({ server: fieldError.message });
      control?.markAsTouched();
      return !control;
    });
    if (error.fieldErrors.length === 0 || unplaced.length > 0) {
      const detail = unplaced.map((e) => e.message).join('; ') || error.detail || error.title;
      this.formError.set(
        `Could not link the account: ${detail}${error.status ? ` (${error.status})` : ''}`,
      );
    }
  }
}
