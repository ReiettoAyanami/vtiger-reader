import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { TicketList } from '../data/lists';
import { ListsApi } from '../data/lists-api';
import { SettingsApi } from '../data/settings-api';
import { ListQuery, TicketOptions, TicketPage, TicketRow } from '../data/tickets';
import { TicketsApi } from '../data/tickets-api';
import { HistoryDialogs } from '../history-dialogs';
import { ListDialog } from './list-dialog/list-dialog';
import { TicketsPage } from './tickets-page';

const LISTS: TicketList[] = [
  { id: 11, name: 'My tickets', filter: { owner: 'me', status: 'any' } },
  { id: 12, name: 'Unassigned', filter: { owner: 'groups', status: 'open' } },
  { id: 13, name: 'All tickets', filter: { owner: 'anyone', status: 'any' } },
];

const OPTIONS: TicketOptions = {
  statuses: [
    { value: 'Open', label: 'Aperto', closed: false },
    { value: 'Closed', label: 'Chiuso', closed: true },
  ],
  groups: [{ id: '20x1', name: 'Primo livello' }],
  picklists: [],
};

function row(id: string, extra: Partial<TicketRow> = {}): TicketRow {
  return {
    id,
    number: `TK-${id}`,
    title: `Ticket ${id}`,
    status: 'Aperto',
    statusIndex: 0,
    priority: '',
    category: 'Hardware',
    createdAt: '2026-11-03T10:00:00Z',
    modifiedAt: '2026-11-03T10:00:00Z',
    owner: { kind: 'me' },
    organization: { id: '11x1', name: null },
    contact: { id: '12x1', name: 'Mario Bianchi' },
    closed: false,
    ...extra,
  };
}

describe('TicketsPage', () => {
  let asked: ListQuery[];
  let namesAsked: string[][];
  let countsAsked: number;
  let dialogs: unknown[];
  let list: (query: ListQuery) => Observable<TicketPage>;

  async function render(url = '/') {
    asked = [];
    namesAsked = [];
    countsAsked = 0;
    dialogs = [];
    TestBed.configureTestingModule({
      imports: [TicketsPage],
      providers: [
        provideRouter([{ path: '', component: TicketsPage }]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: SettingsApi,
          useValue: { getSettings: () => of({ language: 'en', timezone: 'UTC' }) },
        },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
        {
          provide: HistoryDialogs,
          useValue: { open: async (component: unknown) => (dialogs.push(component), undefined) },
        },
        {
          provide: ListsApi,
          useValue: {
            lists: () => of(LISTS),
            counts: () => (countsAsked++, of({ '11': 2, '12': 0, '13': 120 })),
          },
        },
        {
          provide: TicketsApi,
          useValue: {
            options: () => of(OPTIONS),
            list: (query: ListQuery) => (asked.push(query), list(query)),
            names: (ids: string[]) => (namesAsked.push(ids), of({ '11x1': 'Acme Srl' })),
            customers: () => of([]),
          },
        },
      ],
    });
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(TicketsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const text = (selector: string) =>
      [...element.querySelectorAll(selector)].map((e) =>
        (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
    return {
      fixture,
      element,
      text,
      settle: async () => (
        await fixture.whenStable(),
        fixture.detectChanges(),
        await fixture.whenStable()
      ),
    };
  }

  beforeEach(() => {
    list = (query) =>
      of({
        items: [
          row('17x1'),
          row('17x2', {
            status: 'Chiuso',
            statusIndex: 1,
            closed: true,
            owner: { kind: 'group', name: 'Primo livello' },
            organization: null,
          }),
        ],
        page: query.page ?? 0,
        size: 50,
        total: 2,
      });
  });

  it("the user's first list: the rows link to the ticket, with who, when, and the status in its colour", async () => {
    const page = await render();
    expect(asked[0]).toMatchObject({ page: 0, size: 50, sort: 'created', dir: 'desc' });
    expect(asked[0]?.list).toBeUndefined();
    expect(page.text('.row .title')).toEqual(['Ticket 17x1', 'Ticket 17x2']);
    expect(page.element.querySelector('.row')?.getAttribute('href')).toBe('/tickets/17x1');
    expect(page.text('.row .owner')).toEqual(['person Me', 'groups Primo livello']);
    const chips = [...page.element.querySelectorAll<HTMLElement>('.row .status-chip')];
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['Aperto', 'Chiuso']);
    expect(chips[0]!.style.backgroundColor).not.toBe(chips[1]!.style.backgroundColor);
  });

  it("the lists on the side, the first one current; then the organizations' names, once, and the counts", async () => {
    const page = await render();
    await page.settle();
    expect(page.text('.list-name')).toEqual(['My tickets', 'Unassigned', 'All tickets']);
    expect(page.element.querySelector('.list.current .list-name')?.textContent).toBe('My tickets');
    expect(namesAsked).toEqual([['11x1']]);
    expect(page.text('.row .organization')).toEqual(['Acme Srl']);
    expect(countsAsked).toBe(1);
    expect(page.text('.list .count')).toEqual(['2', '120']);
  });

  it('another list: in the address, the tickets asked again', async () => {
    const page = await render();
    page.element.querySelectorAll<HTMLButtonElement>('.list-button')[2]!.click();
    await page.settle();
    expect(TestBed.inject(Router).url).toBe('/?list=13');
    expect(asked.at(-1)).toMatchObject({ list: 13 });
    expect(page.element.querySelector('.list.current .list-name')?.textContent).toBe('All tickets');
  });

  it('+ opens the list editor', async () => {
    const page = await render();
    page.element.querySelector<HTMLButtonElement>('.add-list')!.click();
    await page.settle();
    expect(dialogs).toEqual([ListDialog]);
  });

  it('from the address: list, search, status, page, order', async () => {
    await render('/?list=12&q=vpn&status=Closed&page=2&sort=modified-desc');
    expect(asked[0]).toMatchObject({
      list: 12,
      q: 'vpn',
      status: 'Closed',
      page: 2,
      sort: 'modified',
      dir: 'desc',
    });
  });

  it('pages: the range, and the next page', async () => {
    list = (query) => of({ items: [row('17x1')], page: query.page ?? 0, size: 50, total: 120 });
    const page = await render();
    expect(page.text('.range')).toEqual(['1–1 of 120']);
    page.element.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
    await page.settle();
    expect(TestBed.inject(Router).url).toBe('/?page=1');
  });

  it('no CRM account linked: the card to Settings, instead of the tickets', async () => {
    list = () =>
      throwError(() => ({
        status: 409,
        code: 'crm-not-linked',
        title: 'Conflict',
        detail: '',
        fieldErrors: [],
      }));
    const page = await render();
    expect(page.text('app-link-crm-card h1')).toEqual(['Link your CRM account']);
    expect(page.element.querySelector('.rows')).toBeNull();
  });

  it('a list the CRM no longer matches: said, with Edit the list', async () => {
    list = () =>
      throwError(() => ({
        status: 409,
        code: 'list-outdated',
        title: 'Conflict',
        detail: 'This list asks for a group, which your CRM does not have: edit the list',
        fieldErrors: [],
      }));
    const page = await render();
    expect(page.text('.message.error')).toEqual([
      'This list asks for a group, which your CRM does not have: edit the list.',
    ]);
    expect(page.text('.retry button')).toEqual(['Edit the list', 'Try again']);
  });

  it('the CRM down: said, with Try again', async () => {
    list = () =>
      throwError(() => ({
        status: 503,
        code: 'crm-unreachable',
        title: 'Service Unavailable',
        detail: '',
        fieldErrors: [],
      }));
    const page = await render();
    expect(page.text('.message.error')).toEqual(['The CRM is not reachable right now.']);
  });

  it('nothing found: said', async () => {
    list = () => of({ items: [], page: 0, size: 50, total: 0 });
    const page = await render('/?q=zzz');
    expect(page.text('.message')).toEqual(['No tickets here for “zzz”.']);
  });
});
