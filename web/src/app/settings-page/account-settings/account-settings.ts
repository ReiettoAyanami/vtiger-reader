import { Component, inject, signal, viewChild } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, FormGroupDirective, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { AccountApi } from '../../data/account-api';
import { ApiError } from '../../data/api-error';
import { AuthApi } from '../../data/auth-api';
import { Session } from '../../session/session';

/** The message under a field for its first error, in the UI language. */
function messageFor(errors: ValidationErrors | null): string | null {
  if (!errors) return null;
  if (errors['required']) return 'Required';
  if (errors['server']) return errors['server'];
  return null;
}

const required = (control: AbstractControl) => (String(control.value ?? '') ? null : { required: true });

/**
 * The user's own account, in the settings (design-accounts.md, "Web: /<username>/settings"): a new
 * password, giving the current one (the rules and the history are the API's: their reasons come back
 * under the field), and "Sign out of the other devices". While an administrator views the app as the
 * user, neither is there: the account is the user's own.
 */
@Component({
  selector: 'app-account-settings',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, ReactiveFormsModule],
  templateUrl: './account-settings.html',
  styleUrl: './account-settings.css',
})
export class AccountSettings {
  private readonly accountApi = inject(AccountApi);
  private readonly authApi = inject(AuthApi);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly session = inject(Session);

  protected readonly form = new FormGroup({
    currentPassword: new FormControl('', { nonNullable: true, validators: [required] }),
    newPassword: new FormControl('', { nonNullable: true, validators: [required] }),
  });
  /** Resetting through the directive also forgets the submit: no field turns red after a change. */
  private readonly formDirective = viewChild.required(FormGroupDirective);

  protected readonly newShown = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly signingOut = signal(false);
  protected readonly signOutError = signal<string | null>(null);

  protected errorOf(field: keyof typeof this.form.controls): string | null {
    return messageFor(this.form.controls[field].errors);
  }

  protected async changePassword(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.saving.set(true);
    this.formError.set(null);
    try {
      await firstValueFrom(this.accountApi.changePassword(currentPassword, newPassword));
      this.formDirective().resetForm({ currentPassword: '', newPassword: '' });
      this.newShown.set(false);
      this.snackBar.open('Password changed. Your other devices are signed out.', 'OK', { duration: 6000 });
    } catch (error) {
      this.showErrors(error as ApiError);
    } finally {
      this.saving.set(false);
    }
  }

  protected async signOutElsewhere(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    this.signOutError.set(null);
    try {
      await firstValueFrom(this.authApi.revokeOtherSessions());
      this.snackBar.open('Signed out of the other devices.', 'OK', { duration: 6000 });
    } catch (error) {
      const problem = error as Partial<ApiError>;
      this.signOutError.set(problem.status === null ? 'Not done: the server cannot be reached.' : 'Not done: try again.');
    } finally {
      this.signingOut.set(false);
    }
  }

  /** Each field error under its field (the API's message); anything else above the button. */
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
      this.formError.set(`Could not change the password: ${detail}${error.status ? ` (${error.status})` : ''}`);
    }
  }
}
