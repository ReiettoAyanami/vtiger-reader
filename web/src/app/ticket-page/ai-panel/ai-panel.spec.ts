import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AskEvent, ThreadTurn } from '../../data/ai';
import { AiApi } from '../../data/ai-api';
import { AuthApi } from '../../data/auth-api';
import { Session } from '../../session/session';
import { AiPanel, askedLabel } from './ai-panel';

type Ask = { task: string; question?: string; thread: ThreadTurn[] };

describe('AiPanel', () => {
  let asked: Ask[];
  let answer: (body: Ask, onEvent: (e: AskEvent) => void) => Promise<void>;

  async function render(hasPhotos = false) {
    asked = [];
    TestBed.configureTestingModule({
      imports: [AiPanel],
      providers: [
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: AuthApi,
          useValue: {
            getSession: () => of({ id: 1, username: 'lenzi', role: 'user', impersonatedBy: null }),
          },
        },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
        {
          provide: AiApi,
          useValue: {
            ask: (_id: string, body: Ask, onEvent: (e: AskEvent) => void) => (
              asked.push(body),
              answer(body, onEvent)
            ),
          },
        },
      ],
    });
    await TestBed.inject(Session).load();
    const fixture = TestBed.createComponent(AiPanel);
    fixture.componentRef.setInput('ticketId', '17x1');
    fixture.componentRef.setInput('hasPhotos', hasPhotos);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const text = (selector: string) =>
      [...element.querySelectorAll(selector)].map((e) =>
        (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
    const click = async (label: string) => {
      [...element.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes(label))!
        .click();
      await fixture.whenStable();
    };
    return { fixture, element, text, click };
  }

  beforeEach(() => {
    answer = async (body, onEvent) => {
      onEvent({ event: 'start', data: { model: 'model-a', provider: 'P' } });
      if (body.task === 'history')
        onEvent({
          event: 'sources',
          data: [{ id: '17x2', number: 'TK-2', title: 'Stessa stampante', closedAt: null }],
        });
      onEvent({ event: 'delta', data: { text: 'Gentile cliente, ' } });
      onEvent({ event: 'delta', data: { text: 'la stampante è pronta.' } });
      onEvent({ event: 'done', data: { model: 'model-a', inputTokens: 10, outputTokens: 5 } });
    };
  });

  it('the chips; "Look at the photos" only when there are photos', async () => {
    expect((await render()).text('.chip')).toEqual([
      'Summarize it',
      'Draft the reply',
      'Has this happened before?',
      'Other question…',
    ]);
    TestBed.resetTestingModule();
    expect((await render(true)).text('.chip')).toContain('Look at the photos');
  });

  it('a chip asks, the answer streams in; a reply can be copied, not sent', async () => {
    const page = await render();
    await page.click('Draft the reply');
    expect(asked).toEqual([{ task: 'reply', thread: [] }]);
    expect(page.text('.asked')).toEqual(['Draft the reply']);
    expect(page.text('.answer .text')).toEqual(['Gentile cliente, la stampante è pronta.']);
    const send = [...page.element.querySelectorAll<HTMLButtonElement>('.actions button')].find(
      (b) => b.textContent?.includes('Send to CRM'),
    )!;
    expect(send.disabled).toBe(true);
    expect(page.text('.actions .model')).toEqual(['model-a']);
  });

  it('a follow-up question carries the earlier exchange', async () => {
    const page = await render();
    await page.click('Summarize it');
    await page.click('Other question…');
    const box = page.element.querySelector<HTMLTextAreaElement>('textarea')!;
    box.value = 'Che modello è?';
    box.dispatchEvent(new Event('input'));
    await page.fixture.whenStable();
    await page.click('Ask');
    expect(asked[1]).toEqual({
      task: 'question',
      question: 'Che modello è?',
      thread: [
        { role: 'user', task: 'summary' },
        { role: 'assistant', text: 'Gentile cliente, la stampante è pronta.' },
      ],
    });
  });

  it('"Has this happened before?": the closed tickets found, as links', async () => {
    const page = await render();
    await page.click('Has this happened before?');
    expect(page.element.querySelector('.sources a')?.getAttribute('href')).toBe(
      '/lenzi/tickets/17x2',
    );
  });

  it('no model set up: says so, with Settings', async () => {
    answer = async () => {
      throw {
        status: 409,
        code: 'ai-not-configured',
        title: 'Conflict',
        detail: 'No AI model is set up',
        fieldErrors: [],
      };
    };
    const page = await render();
    await page.click('Summarize it');
    expect(page.text('.problem')).toEqual(['No AI model is set up']);
    expect(page.element.querySelector('.answer a')?.getAttribute('href')).toBe('/lenzi/settings');
  });

  it('the label of what was asked', () => {
    expect(askedLabel({ task: 'question', question: 'Perché?' })).toBe('Perché?');
    expect(askedLabel({ task: 'photos' })).toBe('Look at the photos');
  });
});
