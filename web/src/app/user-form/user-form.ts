import { Clipboard } from '@angular/cdk/clipboard';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Observable } from 'rxjs';

import { AdminApi } from '../data/admin-api';
import { ApiError } from '../data/api-error';
import { User, UserUpdate } from '../data/user';

/** Required, and spaces alone do not count. */
const notBlank: ValidatorFn = (control) => (String(control.value ?? '').trim() ? null : { required: true });

/** The message under a field for its first error, in the UI language. */
function messageFor(errors: ValidationErrors | null): string | null {
  if (!errors) return null;
  if (errors['required']) return 'Required';
  if (errors['server']) return errors['server'];
  return null;
}

/**
 * The user form (design-accounts.md, "Web: /<username>/admin": "one form for create and edit"): it creates a
 * user (username, email, role, starting password typed or generated), or changes the one it is given
 * (email, role, a new password, blocked); the username never changes. The rules of usernames and
 * passwords are the API's: their reasons come back under their field. It says `saved` with the user
 * the API returned, or `cancelled`; it does not know who opened it.
 */
@Component({
  selector: 'app-user-form',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
    ReactiveFormsModule,
  ],
  templateUrl: './user-form.html',
  styleUrl: './user-form.css',
})
export class UserForm implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly clipboard = inject(Clipboard);

  /** The user to change; none to create one. */
  readonly user = input<User | null>(null);
  /** The host may show its own title instead. */
  readonly showTitle = input(true);
  /** The API's answer: the created or the changed user. */
  readonly saved = output<User>();
  readonly cancelled = output<void>();

  protected readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [notBlank] }),
    email: new FormControl('', { nonNullable: true, validators: [notBlank] }),
    role: new FormControl<User['role']>('user', { nonNullable: true }),
    // Required for a new user; for one that exists, empty keeps its password.
    password: new FormControl('', { nonNullable: true }),
    blocked: new FormControl(false, { nonNullable: true }),
  });

  ngOnInit(): void {
    const user = this.user();
    if (user) {
      this.form.setValue({ username: user.username, email: user.email, role: user.role, password: '', blocked: user.blocked });
      this.form.controls.username.disable();
    } else {
      this.form.controls.password.addValidators(notBlank);
    }
  }

  protected errorOf(field: keyof typeof this.form.controls): string | null {
    return messageFor(this.form.controls[field].errors);
  }

  /** The password is readable: after "Generate", or when the eye is pressed. */
  protected readonly passwordShown = signal(false);
  protected readonly copied = signal(false);
  protected readonly generating = signal(false);

  /** A password that follows the rules, from the API's generator, shown so that it can be passed on. */
  protected generate(): void {
    if (this.generating()) return;
    this.generating.set(true);
    this.formError.set(null);
    this.api.generatedPassword().subscribe({
      next: (password) => {
        this.form.controls.password.setValue(password);
        this.passwordShown.set(true);
        this.copied.set(false);
        this.generating.set(false);
      },
      error: (error: ApiError) => {
        this.generating.set(false);
        this.formError.set(`Could not generate a password: ${error.title}${error.status ? ` (${error.status})` : ''}`);
      },
    });
  }

  protected copy(): void {
    this.copied.set(this.clipboard.copy(this.form.controls.password.value));
  }

  /** A request is out: Save is disabled (no double submit). */
  protected readonly saving = signal(false);
  /** An error of the request that belongs to no field. */
  protected readonly formError = signal<string | null>(null);

  protected save(): void {
    // The guard, not only the disabled button: a second tap can arrive before the view updates.
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const typed = this.form.getRawValue();
    const editing = this.user();
    let request: Observable<User>;
    if (editing) {
      // Only what changed: a reset is a password typed; an untouched form saves nothing.
      const changes: UserUpdate = {};
      if (typed.email.trim().toLowerCase() !== editing.email) changes.email = typed.email;
      if (typed.role !== editing.role) changes.role = typed.role;
      if (typed.password !== '') changes.password = typed.password;
      if (typed.blocked !== editing.blocked) changes.blocked = typed.blocked;
      if (Object.keys(changes).length === 0) {
        this.saved.emit(editing);
        return;
      }
      request = this.api.updateUser(editing.id, changes);
    } else {
      request = this.api.createUser({ username: typed.username, email: typed.email, password: typed.password, role: typed.role });
    }

    this.saving.set(true);
    this.formError.set(null);
    request.subscribe({
      next: (saved) => this.saved.emit(saved),
      error: (error: ApiError) => {
        this.saving.set(false);
        this.showErrors(error);
      },
    });
  }

  /** Each field error under its field (the API's message); anything else above the buttons. */
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
      this.formError.set(`Could not save: ${detail}${error.status ? ` (${error.status})` : ''}`);
    }
  }
}
