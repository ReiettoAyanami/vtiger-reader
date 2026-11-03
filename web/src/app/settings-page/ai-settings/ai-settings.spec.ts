import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { Provider, TaskModels } from '../../data/ai';
import { AiApi } from '../../data/ai-api';
import { HistoryDialogs } from '../../history-dialogs';
import { AiSettings, usageByModel } from './ai-settings';

const PROVIDERS: Provider[] = [
  { id: 1, kind: 'anthropic', label: 'Claude', baseUrl: null, hasKey: true, keyHint: '…5678' },
  {
    id: 2,
    kind: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://ollama.lan:11434',
    hasKey: false,
    keyHint: null,
  },
];

const TASK_MODELS: TaskModels = {
  default: { providerId: 1, model: 'claude-opus-5-5' },
  summary: null,
  reply: null,
  photos: null,
  history: null,
  question: null,
};

describe('usageByModel', () => {
  it('the last 30 days per model, the most used first', () => {
    expect(
      usageByModel([
        {
          day: '2026-11-03',
          kind: 'anthropic',
          model: 'a',
          task: 'summary',
          calls: 1,
          tokensIn: 10,
          tokensOut: 5,
        },
        {
          day: '2026-11-02',
          kind: 'anthropic',
          model: 'a',
          task: 'reply',
          calls: 2,
          tokensIn: 20,
          tokensOut: 5,
        },
        {
          day: '2026-11-03',
          kind: 'ollama',
          model: 'b',
          task: 'summary',
          calls: 1,
          tokensIn: 100,
          tokensOut: 50,
        },
      ]),
    ).toEqual([
      { model: 'b', calls: 1, tokensIn: 100, tokensOut: 50 },
      { model: 'a', calls: 3, tokensIn: 30, tokensOut: 10 },
    ]);
  });
});

describe('AiSettings', () => {
  let saved: Array<Partial<TaskModels>>;

  async function render(providers: Provider[] = PROVIDERS) {
    saved = [];
    TestBed.configureTestingModule({
      imports: [AiSettings],
      providers: [
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
        { provide: HistoryDialogs, useValue: { open: async () => undefined } },
        {
          provide: AiApi,
          useValue: {
            providers: () => of(providers),
            tasks: () => of(TASK_MODELS),
            usage: () => of([]),
            models: () => of([]),
            setTasks: (patch: Partial<TaskModels>) => (saved.push(patch), of(TASK_MODELS)),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AiSettings);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const text = (selector: string) =>
      [...element.querySelectorAll(selector)].map((e) =>
        (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
    return { fixture, element, text };
  }

  it('the providers with their kind and key hint, never a key', async () => {
    const page = await render();
    expect(page.text('.provider-name')).toEqual(['Claude', 'Ollama']);
    expect(page.text('.provider .note')).toEqual([
      'Anthropic · key …5678',
      'Ollama · http://ollama.lan:11434',
    ]);
  });

  it('the default model and one row per task; saved all together', async () => {
    const page = await render();
    expect(page.text('.choice-label')).toEqual([
      'Default',
      'Summarize it',
      'Draft the reply',
      'Look at the photos',
      'Has this happened before?',
      'Other questions',
    ]);
    expect(page.element.querySelector<HTMLInputElement>('.choice-model input')?.value).toBe(
      'claude-opus-5-5',
    );
    [...page.element.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Save the models'))!
      .click();
    await page.fixture.whenStable();
    expect(saved).toEqual([{ ...TASK_MODELS }]);
  });

  it('no provider yet: says how to start, no model table', async () => {
    const page = await render([]);
    expect(page.text('.ai > .note')[0]).toContain('No provider yet');
    expect(page.element.querySelector('.choice')).toBeNull();
  });
});
