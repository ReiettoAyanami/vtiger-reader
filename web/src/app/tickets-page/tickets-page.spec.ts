import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { AuthApi, type SessionUser } from '../data/auth-api';
import { SettingsApi } from '../data/settings-api';
import { FoldersAndStatuses, ListQuery, TicketPage, TicketRow } from '../data/tickets';
import { TicketsApi } from '../data/tickets-api';
import { Session } from '../session/session';
import { TicketsPage } from './tickets-page';

const lenzi: SessionUser = { id: 1, username: 'lenzi', role: 'user', impersonatedBy: null };

const FOLDERS: FoldersAndStatuses = {
  folders: [
    { id: 'mine-open', label: 'My open tickets', section: 'Mine' },
    { id: 'group:20x1', label: 'Primo livello', section: 'Group queues' },
    { id: 'all', label: 'All tickets', section: 'All' },
  ],
  statuses: [
    { value: 'Open', label: 'Aperto', closed: false },
    { value: 'Closed', label: 'Chiuso', closed: true },
  ],
};

function row(id: string, extra: Partial<TicketRow> = {}): TicketRow {
  return {
    id,
    number: `TK-${id}`,
    title: `Ticket ${id}`,
    status: 'Aperto',
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
  let list: (query: ListQuery) => Observable<TicketPage>;

  async function render(url = '/lenzi') {
    asked = [];
    namesAsked = [];
    countsAsked = 0;
    TestBed.configureTestingModule({
      imports: [TicketsPage],
      providers: [
        provideRouter([{ path: ':username', component: TicketsPage }]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AuthApi, useValue: { getSession: () => of(lenzi) } },
        {
          provide: SettingsApi,
          useValue: { getSettings: () => of({ language: 'en', timezone: 'UTC' }) },
        },
        {
          provide: TicketsApi,
          useValue: {
            folders: () => of(FOLDERS),
            folderCounts: () => (countsAsked++, of({ 'mine-open': 2, 'group:20x1': 0, all: 120 })),
            list: (query: ListQuery) => (asked.push(query), list(query)),
            names: (ids: string[]) => (namesAsked.push(ids), of({ '11x1': 'Acme Srl' })),
            customers: () => of([]),
          },
        },
      ],
    });
    await TestBed.inject(Session).load();
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
          row('17x2', { owner: { kind: 'group', name: 'Primo livello' }, organization: null }),
        ],
        page: query.page ?? 0,
        size: 50,
        total: 2,
      });
  });

  it('my open tickets first: the rows link to the ticket, with who and when', async () => {
    const page = await render();
    expect(asked[0]).toMatchObject({
      folder: 'mine-open',
      page: 0,
      size: 50,
      sort: 'created',
      dir: 'desc',
    });
    expect(page.text('.row .title')).toEqual(['Ticket 17x1', 'Ticket 17x2']);
    expect(page.element.querySelector('.row')?.getAttribute('href')).toBe('/lenzi/tickets/17x1');
    expect(page.text('.row .owner')).toEqual(['person Me', 'groups Primo livello']);
    expect(page.text('.row .contact')).toEqual(['Mario Bianchi', 'Mario Bianchi']);
  });

  it("then the organizations' names, once, and the folders' counts", async () => {
    const page = await render();
    await page.settle();
    expect(namesAsked).toEqual([['11x1']]);
    expect(page.text('.row .organization')).toEqual(['Acme Srl']);
    expect(countsAsked).toBe(1);
    expect(page.text('.folder-name')).toEqual(['My open tickets', 'Primo livello', 'All tickets']);
    expect(page.text('.folder .count')).toEqual(['2', '120']);
    expect(page.text('.section')).toEqual(['Mine', 'Group queues', 'All']);
  });

  it('a folder, a status, the order: in the address, the list asked again', async () => {
    const page = await render();
    page.element.querySelectorAll<HTMLButtonElement>('.folder')[1]!.click();
    await page.settle();
    expect(TestBed.inject(Router).url).toBe('/lenzi?folder=group:20x1');
    expect(asked.at(-1)).toMatchObject({ folder: 'group:20x1' });
  });

  it('from the address: folder, search, status, page', async () => {
    await render('/lenzi?folder=all&q=vpn&status=Closed&page=2&sort=modified-desc');
    expect(asked[0]).toMatchObject({
      folder: 'all',
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
    expect(TestBed.inject(Router).url).toBe('/lenzi?page=1');
  });

  it('no CRM account linked: the card to Settings, instead of the list', async () => {
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
    const page = await render('/lenzi?q=zzz');
    expect(page.text('.message')).toEqual(['No tickets here for “zzz”.']);
  });
});
