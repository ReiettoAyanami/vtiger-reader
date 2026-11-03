import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ApiError } from '../data/api-error';
import { LANGUAGES, Settings } from '../data/settings';
import { SettingsApi } from '../data/settings-api';
import { Appearance } from '../ui/appearance';
import { AccountSettings } from './account-settings/account-settings';
import { CrmLinkSettings } from './crm-link-settings/crm-link-settings';

/** The time zones this browser knows, UTC (which it does not list) and the current one. */
function zoneOptions(current: string): string[] {
  return [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', current].filter(Boolean))].sort();
}

/** The value must be one of `values`: the list offers them all. */
function oneOf(values: () => ReadonlySet<string>): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    control.value && !values().has(control.value) ? { notInList: true } : null;
}

/** A field's error in words: the form's own, or the API's. */
function messageFor(errors: ValidationErrors | null): string | null {
  if (!errors) return null;
  if (errors['required']) return 'Required';
  if (errors['notInList']) return 'Choose one of the list';
  if (errors['server']) return errors['server'];
  return 'Not valid';
}

type Field = 'language' | 'timezone';

/**
 * The user's preferences, in one form: the language of the interface (English only for now; lenzi,
 * 2026-11-03) and the time zone the CRM's times are shown in. Save sends what changed; the form then
 * shows what the API saved. Below, the user's CRM account, their own account here (password, other
 * devices) and this browser's display choice.
 */
@Component({
  selector: 'app-settings-page',
  imports: [
    AccountSettings,
    CrmLinkSettings,
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    ReactiveFormsModule,
  ],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage {
  private readonly api = inject(SettingsApi);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly appearance = inject(Appearance);

  protected readonly languages = LANGUAGES;
  protected readonly settings = rxResource({ stream: () => this.api.getSettings() });

  private readonly zones = computed(() => zoneOptions(this.settings.value()?.timezone ?? ''));
  private readonly zoneNames = computed(() => new Set(this.zones()));

  protected readonly form = new FormGroup({
    language: new FormControl('en', { nonNullable: true, validators: [Validators.required] }),
    timezone: new FormControl('', { nonNullable: true, validators: [Validators.required, oneOf(() => this.zoneNames())] }),
  });

  private readonly typedZone = toSignal(this.form.controls.timezone.valueChanges, { initialValue: '' });

  /** The time zones offered: all while the field holds one, else those whose name has what is typed. */
  protected readonly zoneChoices = computed(() => {
    const typed = this.typedZone().trim().toLowerCase().replaceAll(' ', '_');
    if (!typed || this.zoneNames().has(this.typedZone())) return this.zones();
    return this.zones().filter((zone) => zone.toLowerCase().includes(typed));
  });

  /** A request is out: Save is disabled (no double submit). */
  protected readonly saving = signal(false);
  /** What could not be said under a field. */
  protected readonly formError = signal<string | null>(null);

  protected readonly failure = computed(() => {
    const failure = this.settings.error();
    if (!failure) return null;
    // The interceptor's ApiError is not an Error: the resource wraps it, as its cause.
    const error = (failure.cause ?? failure) as Partial<ApiError>;
    return `Could not load the settings${error.status ? ` (${error.status})` : ''}`;
  });

  constructor() {
    // The form shows the settings as the API has them: when they arrive, and after a save.
    effect(() => {
      if (!this.settings.hasValue()) return;
      const { language, timezone } = this.settings.value();
      this.form.reset({ language, timezone });
    });
  }

  protected errorOf(field: Field): string | null {
    return messageFor(this.form.controls[field].errors);
  }

  protected save(): void {
    // The guard, not only the disabled button: a second tap can arrive before the view updates.
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { language, timezone } = this.form.controls;
    const patch: Partial<Settings> = {
      ...(language.dirty ? { language: language.value as Settings['language'] } : {}),
      ...(timezone.dirty ? { timezone: timezone.value } : {}),
    };
    if (Object.keys(patch).length === 0) return;
    this.saving.set(true);
    this.formError.set(null);
    this.api.updateSettings(patch).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.settings.set(saved);
        this.snackBar.open('Settings saved', undefined, { duration: 3000 });
      },
      error: (error: ApiError) => {
        this.saving.set(false);
        this.showErrors(error);
      },
    });
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
      this.formError.set(`Could not save: ${detail}${error.status ? ` (${error.status})` : ''}`);
    }
  }
}
