import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import { PROVIDER_KINDS, Provider, ProviderKind } from '../../data/ai';
import { AiApi } from '../../data/ai-api';
import { ApiError } from '../../data/api-error';

/**
 * A provider of the user's own, new or edited (plan 4.1): its kind, a label, its address when the
 * kind needs one, its API key. On an edit the key field stays empty: the saved key stays unless a
 * new one is typed (it never comes back from the server).
 */
@Component({
  selector: 'app-provider-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data ? 'Edit the provider' : 'New AI provider' }}</h2>
    <mat-dialog-content>
      <form class="form" [formGroup]="form" (ngSubmit)="save()" id="provider-form">
        <mat-form-field appearance="outline">
          <mat-label>Kind</mat-label>
          <mat-select formControlName="kind">
            @for (k of kinds; track k.kind) {
              <mat-option [value]="k.kind">{{ k.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="label" maxlength="80" autocomplete="off" />
        </mat-form-field>
        @if (current().needsUrl) {
          <mat-form-field appearance="outline">
            <mat-label>Address</mat-label>
            <input
              matInput
              formControlName="baseUrl"
              type="url"
              autocomplete="off"
              [placeholder]="
                kind() === 'ollama' ? 'http://ollama.lan:11434' : 'https://api.example.com/v1'
              "
            />
            <mat-hint>{{
              kind() === 'ollama'
                ? 'Where Ollama runs (it must be in AI_PRIVATE_HOSTS if it is on your network)'
                : 'The OpenAI-style API address, usually ending in /v1'
            }}</mat-hint>
          </mat-form-field>
        }
        @if (kind() === 'claude-code') {
          <p class="how">
            Claude Code keeps its own sign-in on this computer, so there is nothing to paste. If it is
            not signed in yet, open Claude Code, sign in with your Claude account, then save here.
          </p>
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>API key{{ current().needsKey ? '' : ' (if it has one)' }}</mat-label>
            <input matInput formControlName="apiKey" type="password" autocomplete="off" />
            @if (data?.hasKey) {
              <mat-hint>Saved ({{ data?.keyHint }}): leave empty to keep it</mat-hint>
            } @else {
              <mat-hint>Kept encrypted on this PC, never shown again</mat-hint>
            }
          </mat-form-field>
        }
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="submit" form="provider-form" [disabled]="saving()">Save</button>
    </mat-dialog-actions>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 8px;
    }
    mat-form-field {
      width: 100%;
    }
    .how {
      margin: 0;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class ProviderDialog {
  private readonly api = inject(AiApi);
  private readonly ref = inject<MatDialogRef<ProviderDialog, Provider>>(MatDialogRef);
  protected readonly data = inject<Provider | null>(MAT_DIALOG_DATA);
  protected readonly kinds = PROVIDER_KINDS;

  protected readonly form = new FormGroup({
    kind: new FormControl<ProviderKind>(
      { value: this.data?.kind ?? 'anthropic', disabled: this.data !== null },
      { nonNullable: true },
    ),
    label: new FormControl(this.data?.label ?? '', { nonNullable: true }),
    baseUrl: new FormControl(this.data?.baseUrl ?? '', { nonNullable: true }),
    apiKey: new FormControl('', { nonNullable: true }),
  });

  protected readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value,
  });
  protected readonly current = computed(
    () => PROVIDER_KINDS.find((k) => k.kind === this.kind()) ?? PROVIDER_KINDS[0],
  );
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const { kind, label, baseUrl, apiKey } = this.form.getRawValue();
    const name = label.trim() || this.current().name.split(' (')[0]!;
    const input = {
      kind,
      label: name,
      ...(this.current().needsUrl ? { baseUrl: baseUrl.trim() } : {}),
      ...(kind !== 'claude-code' && (apiKey.trim() || !this.data) ? { apiKey: apiKey.trim() } : {}),
    };
    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = await firstValueFrom(
        this.data ? this.api.updateProvider(this.data.id, input) : this.api.createProvider(input),
      );
      this.ref.close(saved);
    } catch (failure) {
      const problem = failure as ApiError;
      this.error.set(
        `Not saved: ${problem.fieldErrors?.map((e) => `${e.field}: ${e.message}`).join('; ') || problem.detail || problem.title}`,
      );
    } finally {
      this.saving.set(false);
    }
  }
}
