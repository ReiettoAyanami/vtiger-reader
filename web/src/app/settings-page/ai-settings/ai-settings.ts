import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ConfirmDialog, ConfirmDialogData } from '../../confirm-dialog/confirm-dialog';
import {
  ModelInfo,
  PROVIDER_KINDS,
  Provider,
  TASKS,
  TaskModels,
  TaskSlot,
  UsageRow,
} from '../../data/ai';
import { AiApi } from '../../data/ai-api';
import { ApiError } from '../../data/api-error';
import { HistoryDialogs } from '../../history-dialogs';
import { ProviderDialog } from './provider-dialog';

/** A row of the "which model" table, as edited. */
interface Choice {
  slot: TaskSlot;
  label: string;
  providerId: number | null;
  model: string;
}

/** The usage of the last 30 days, per model. */
export function usageByModel(
  rows: UsageRow[],
): Array<{ model: string; calls: number; tokensIn: number; tokensOut: number }> {
  const byModel = new Map<
    string,
    { model: string; calls: number; tokensIn: number; tokensOut: number }
  >();
  for (const r of rows) {
    const sum = byModel.get(r.model) ?? { model: r.model, calls: 0, tokensIn: 0, tokensOut: 0 };
    sum.calls += r.calls;
    sum.tokensIn += r.tokensIn;
    sum.tokensOut += r.tokensOut;
    byModel.set(r.model, sum);
  }
  return [...byModel.values()].sort(
    (a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut),
  );
}

/**
 * The user's AI help (plan 4.1, 4.2, 4.7; lenzi, 2026-11-03: "every user must be able to decide
 * which Provider to use and also what model for what, keep it in the database"): their providers,
 * the default model and, where wanted, another model per task, and what they used.
 */
@Component({
  selector: 'app-ai-settings',
  imports: [
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
  ],
  templateUrl: './ai-settings.html',
  styleUrl: './ai-settings.css',
})
export class AiSettings {
  private readonly api = inject(AiApi);
  private readonly dialogs = inject(HistoryDialogs);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly providers = rxResource({ stream: () => this.api.providers() });
  protected readonly tasks = rxResource({ stream: () => this.api.tasks() });
  protected readonly usage = rxResource({ stream: () => this.api.usage() });

  protected readonly providerList = computed(() =>
    this.providers.hasValue() ? this.providers.value() : [],
  );
  protected readonly usageRows = computed(() =>
    usageByModel(this.usage.hasValue() ? this.usage.value() : []),
  );

  /** Each provider's models, read when needed (a select opened, a Test). */
  protected readonly models = signal<Record<number, ModelInfo[]>>({});

  protected readonly choices = signal<Choice[]>([]);
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      if (!this.tasks.hasValue()) return;
      this.choices.set(this.toChoices(this.tasks.value()));
    });
  }

  private toChoices(models: TaskModels): Choice[] {
    const slots: Array<{ slot: TaskSlot; label: string }> = [
      { slot: 'default', label: 'Default' },
      ...TASKS.map((t) => ({ slot: t.task, label: t.label })),
    ];
    return slots.map(({ slot, label }) => ({
      slot,
      label,
      providerId: models[slot]?.providerId ?? null,
      model: models[slot]?.model ?? '',
    }));
  }

  protected kindName(provider: Provider): string {
    return (
      PROVIDER_KINDS.find((k) => k.kind === provider.kind)?.name.split(' (')[0] ?? provider.kind
    );
  }

  protected modelsOf(providerId: number | null): ModelInfo[] {
    return providerId === null ? [] : (this.models()[providerId] ?? []);
  }

  /** The models a row offers: those of its provider whose name has what is typed; for the photos, those that read images. */
  protected offered(choice: Choice): ModelInfo[] {
    const typed = choice.model.trim().toLowerCase();
    return this.modelsOf(choice.providerId).filter(
      (m) =>
        (choice.slot !== 'photos' || m.vision !== false) &&
        (!typed || m.id.toLowerCase().includes(typed) || m.name.toLowerCase().includes(typed)),
    );
  }

  protected async loadModels(providerId: number | null, announce = false): Promise<void> {
    if (providerId === null) return;
    try {
      const list = await firstValueFrom(this.api.models(providerId));
      this.models.update((all) => ({ ...all, [providerId]: list }));
      if (announce)
        this.snackBar.open(`It works: ${list.length} models`, undefined, { duration: 3000 });
    } catch (failure) {
      const problem = failure as ApiError;
      this.snackBar.open(`Does not work: ${problem.detail || problem.title}`, 'OK', {
        duration: 8000,
      });
    }
  }

  protected setProvider(choice: Choice, providerId: number | null): void {
    this.choices.update((all) =>
      all.map((c) =>
        c.slot === choice.slot
          ? { ...c, providerId, model: providerId === c.providerId ? c.model : '' }
          : c,
      ),
    );
    void this.loadModels(providerId);
  }

  protected setModel(choice: Choice, model: string): void {
    this.choices.update((all) => all.map((c) => (c.slot === choice.slot ? { ...c, model } : c)));
  }

  protected async saveChoices(): Promise<void> {
    if (this.saving()) return;
    const patch = Object.fromEntries(
      this.choices().map((c) => [
        c.slot,
        c.providerId !== null && c.model.trim()
          ? { providerId: c.providerId, model: c.model.trim() }
          : null,
      ]),
    ) as Partial<TaskModels>;
    this.saving.set(true);
    try {
      this.tasks.set(await firstValueFrom(this.api.setTasks(patch)));
      this.snackBar.open('Models saved', undefined, { duration: 3000 });
    } catch (failure) {
      const problem = failure as ApiError;
      this.snackBar.open(
        `Not saved: ${problem.fieldErrors?.[0]?.message || problem.detail || problem.title}`,
        'OK',
        { duration: 8000 },
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async addProvider(): Promise<void> {
    const saved = await this.dialogs.open<ProviderDialog, Provider | null, Provider>(
      ProviderDialog,
      null,
      { width: '520px', maxWidth: '96vw' },
    );
    if (!saved) return;
    this.providers.reload();
    void this.loadModels(saved.id, true);
  }

  protected async editProvider(provider: Provider): Promise<void> {
    const saved = await this.dialogs.open<ProviderDialog, Provider | null, Provider>(
      ProviderDialog,
      provider,
      { width: '520px', maxWidth: '96vw' },
    );
    if (saved) this.providers.reload();
  }

  protected async deleteProvider(provider: Provider): Promise<void> {
    const deleted = await this.dialogs.open<ConfirmDialog, ConfirmDialogData, true>(
      ConfirmDialog,
      {
        title: `Delete “${provider.label}”?`,
        message: 'Its key goes with it, and the tasks that used it go back to the default model.',
        confirm: 'Delete',
        action: () => this.api.deleteProvider(provider.id),
      },
      { width: '400px' },
    );
    if (!deleted) return;
    this.providers.reload();
    this.tasks.reload();
  }
}
