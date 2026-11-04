import { Component, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

import { SimilarSource, TASKS, Task, ThreadTurn } from '../../data/ai';
import { AiApi } from '../../data/ai-api';
import { ApiError } from '../../data/api-error';

/** One request of the panel and its answer, as shown. */
export interface Exchange {
  task: Task;
  question?: string;
  text: string;
  sources: SimilarSource[];
  streaming: boolean;
  error: string | null;
  /** The error is "no model set up": the page links to Settings. */
  needsSetup: boolean;
  model: string | null;
}

/** What a request shows in the thread: the chip, or the question asked. */
export function askedLabel(exchange: Pick<Exchange, 'task' | 'question'>): string {
  if (exchange.task === 'question') return exchange.question ?? '';
  return TASKS.find((t) => t.task === exchange.task)?.label ?? exchange.task;
}

/**
 * The AI help on a ticket (plan 4.4), closed until the user opens it: a few chips (summarize, draft
 * the reply, look at the photos, has this happened before, another question) and a short thread
 * about this ticket only, kept by the page and gone when the panel closes. Answers stream in; one
 * can be stopped. A drafted reply can be copied; sending it to the CRM is not there yet (read-only).
 */
@Component({
  selector: 'app-ai-panel',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './ai-panel.html',
  styleUrl: './ai-panel.css',
})
export class AiPanel implements OnDestroy {
  private readonly api = inject(AiApi);
  private readonly snackBar = inject(MatSnackBar);

  readonly ticketId = input.required<string>();
  /** The ticket has photos (images that are not signature logos): "Look at the photos" is offered. */
  readonly hasPhotos = input(false);
  readonly closed = output<void>();

  protected readonly exchanges = signal<Exchange[]>([]);
  protected readonly busy = computed(() => this.exchanges().some((e) => e.streaming));
  protected readonly asking = signal(false);
  protected readonly question = new FormControl('', { nonNullable: true });
  /** What is typed, as a signal: the view updates as it changes (no zone.js here). */
  protected readonly questionText = toSignal(this.question.valueChanges, { initialValue: '' });
  protected readonly askedLabel = askedLabel;

  protected readonly chips = computed(() =>
    TASKS.filter((t) => t.task !== 'photos' || this.hasPhotos()),
  );

  private controller: AbortController | null = null;

  ngOnDestroy(): void {
    this.controller?.abort();
  }

  protected choose(task: Task): void {
    if (task === 'question') {
      this.asking.set(true);
      return;
    }
    void this.ask(task);
  }

  protected sendQuestion(): void {
    const question = this.question.value.trim();
    if (!question || this.busy()) return;
    this.question.setValue('');
    this.asking.set(false);
    void this.ask('question', question);
  }

  protected stop(): void {
    this.controller?.abort();
    this.update((e) =>
      e.streaming ? { ...e, streaming: false, error: e.text ? null : 'Stopped' } : e,
    );
  }

  protected close(): void {
    this.controller?.abort();
    this.exchanges.set([]);
    this.closed.emit();
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.snackBar.open('Copied', undefined, { duration: 2000 });
    } catch {
      this.snackBar.open('Could not copy: select the text instead', undefined, { duration: 4000 });
    }
  }

  /** The earlier, finished exchanges, as the API takes them. */
  private thread(): ThreadTurn[] {
    return this.exchanges()
      .filter((e) => !e.streaming && !e.error && e.text)
      .flatMap((e): ThreadTurn[] => [
        { role: 'user', task: e.task, ...(e.question ? { question: e.question } : {}) },
        { role: 'assistant', text: e.text },
      ]);
  }

  private update(change: (exchange: Exchange) => Exchange): void {
    this.exchanges.update((all) => all.map((e, i) => (i === all.length - 1 ? change(e) : e)));
  }

  private async ask(task: Task, question?: string): Promise<void> {
    if (this.busy()) return;
    const thread = this.thread();
    this.exchanges.update((all) => [
      ...all,
      {
        task,
        ...(question ? { question } : {}),
        text: '',
        sources: [],
        streaming: true,
        error: null,
        needsSetup: false,
        model: null,
      },
    ]);
    this.controller = new AbortController();
    try {
      await this.api.ask(
        this.ticketId(),
        { task, ...(question ? { question } : {}), thread },
        (event) => {
          switch (event.event) {
            case 'start':
              this.update((e) => ({ ...e, model: event.data.model }));
              break;
            case 'sources':
              this.update((e) => ({ ...e, sources: event.data }));
              break;
            case 'delta':
              this.update((e) => ({ ...e, text: e.text + event.data.text }));
              break;
            case 'done':
              this.update((e) => ({ ...e, streaming: false, model: event.data.model }));
              break;
            case 'error':
              this.update((e) => ({ ...e, streaming: false, error: event.data.message }));
              break;
          }
        },
        this.controller.signal,
      );
      this.update((e) => (e.streaming ? { ...e, streaming: false } : e));
    } catch (failure) {
      const error = failure as ApiError;
      const needsSetup = error.code === 'ai-not-configured';
      this.update((e) => ({
        ...e,
        streaming: false,
        needsSetup,
        error: error.detail || error.title || 'The AI did not answer',
      }));
    }
  }
}
