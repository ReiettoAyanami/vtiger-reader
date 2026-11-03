import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, of, throwError } from 'rxjs';

import { AuthApi, type SessionUser } from '../data/auth-api';
import { SettingsApi } from '../data/settings-api';
import { Attachment, TicketDetail } from '../data/tickets';
import { TicketsApi } from '../data/tickets-api';
import { AiApi } from '../data/ai-api';
import { HistoryDialogs } from '../history-dialogs';
import { Session } from '../session/session';
import { TicketPage } from './ticket-page';

const lenzi: SessionUser = { id: 1, username: 'lenzi', role: 'user', impersonatedBy: null };

const TICKET: TicketDetail = {
  id: '17x1',
  number: 'TK-2026-000001',
  title: 'Stampante ferma',
  status: 'Aperto',
  statusIndex: 0,
  priority: 'Alta',
  category: 'Hardware',
  createdAt: '2026-11-03T10:00:00Z',
  modifiedAt: '2026-11-03T12:00:00Z',
  owner: { kind: 'me' },
  organization: { id: '11x1', name: 'Acme Srl' },
  contact: { id: '12x1', name: 'Mario Bianchi' },
  closed: false,
  crmLink: 'https://crm.example.invalid/index.php?module=HelpDesk&view=Detail&record=1',
  description: {
    text: 'La stampante non stampa.',
    cut: true,
    html: '<p>La stampante non stampa.</p>',
  },
  solution: null,
  fields: [{ name: 'gruppo_di_supporto', label: 'Gruppo di supporto', value: 'Alpha' }],
  comments: [
    {
      id: '30x1',
      at: '2026-11-03T10:00:01Z',
      author: { kind: 'customer', id: '12x1', name: 'Mario Bianchi' },
      private: false,
      body: { text: 'La stampante non stampa.', cut: false },
      html: '<p>La stampante non stampa.</p>',
      files: ['15x1', '15x2'],
      sameAsDescription: true,
    },
    {
      id: '30x2',
      at: '2026-11-03T10:30:00Z',
      author: { kind: 'colleague', signedAs: 'Giacomo' },
      private: false,
      body: { text: 'Ci guardo io.', cut: false },
      html: '<p>Ci guardo io.</p>',
      files: [],
      sameAsDescription: false,
    },
    {
      id: '30x3',
      at: '2026-11-03T11:00:00Z',
      author: { kind: 'me' },
      private: true,
      body: { text: 'Riavviata.', cut: false },
      html: '<p>Riavviata.</p>',
      files: ['15x3'],
      sameAsDescription: false,
    },
  ],
  documents: [{ id: '7x1', title: 'Log', fileName: 'log.pdf', files: ['15x9'] }],
};

const file = (id: string, extra: Partial<Attachment>): Attachment => ({
  id,
  name: `${id}.png`,
  type: 'image/png',
  size: 20_000,
  inline: true,
  width: 300,
  height: 100,
  from: { kind: 'comment', id: '30x1' },
  signature: false,
  mark: null,
  ...extra,
});

const ATTACHMENTS: Attachment[] = [
  file('15x1', { name: 'image001.png', signature: true }),
  file('15x2', { name: 'foto.jpg', type: 'image/jpeg', width: 800, height: 600 }),
  file('15x3', {
    name: 'report.xlsx',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    inline: false,
    width: null,
    height: null,
  }),
  file('15x9', {
    name: 'log.pdf',
    type: 'application/pdf',
    from: { kind: 'document', id: '7x1' },
    width: null,
    height: null,
  }),
];

describe('TicketPage', () => {
  let ticket: () => Observable<TicketDetail>;
  let marks: Array<[string, string | null]>;

  async function render() {
    marks = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: ':username/tickets/:id', component: TicketPage }]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AuthApi, useValue: { getSession: () => of(lenzi) } },
        {
          provide: SettingsApi,
          useValue: { getSettings: () => of({ language: 'en', timezone: 'UTC' }) },
        },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
        { provide: HistoryDialogs, useValue: { open: async () => undefined } },
        { provide: AiApi, useValue: { ask: async () => undefined } },
        {
          provide: TicketsApi,
          useValue: {
            ticket: () => ticket(),
            attachments: () => of(ATTACHMENTS),
            fileUrl: (id: string, fileId: string, download = false) =>
              `/api/tickets/${id}/files/${fileId}${download ? '?download=true' : ''}`,
            mark: (_id: string, fileId: string, mark: string | null) => (
              marks.push([fileId, mark]),
              of({ mark })
            ),
          },
        },
      ],
    });
    await TestBed.inject(Session).load();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/lenzi/tickets/17x1', TicketPage);
    await harness.fixture.whenStable();
    harness.detectChanges();
    const element = harness.routeNativeElement as HTMLElement;
    const text = (selector: string) =>
      [...element.querySelectorAll(selector)].map((e) =>
        (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
    return { fixture: harness.fixture, element, text };
  }

  beforeEach(() => {
    ticket = () => of(TICKET);
  });

  it('the header: number, status, title, who, Open in CRM', async () => {
    const page = await render();
    expect(page.text('.header .number')).toEqual(['TK-2026-000001']);
    expect(page.text('.header .title')).toEqual(['Stampante ferma']);
    expect(page.text('.facts dd')).toEqual(['Acme Srl', 'Mario Bianchi', 'Me', '10:00', '12:00']);
    expect(
      page.element.querySelector('a[href^="https://crm.example.invalid"]')?.getAttribute('target'),
    ).toBe('_blank');
  });

  it('the write actions are all there, all disabled: read-only for now', async () => {
    const page = await render();
    const buttons = [
      ...page.element.querySelectorAll<HTMLButtonElement>('.disabled-action button'),
    ];
    expect(buttons.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'reply Reply',
      'add_comment Comment',
      'assignment_ind Take charge',
      'task_alt Close',
      'edit Edit',
    ]);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it('the request cleaned; the comments in order, the repeated mail folded, a private one marked', async () => {
    const page = await render();
    expect(page.text('app-mail-view .clean')[0]).toBe('La stampante non stampa.');
    expect(page.text('.repeated')).toEqual([
      'unfold_more The request, as its first comment (10:00)',
    ]);
    // a colleague, by the name they signed with
    expect(page.text('.comment .author')).toEqual(['Giacomo (colleague)', 'Me']);
    // the status in its own colour
    expect(
      page.element.querySelector<HTMLElement>('.header .status-chip')?.style.backgroundColor,
    ).toContain('oklch');
    expect(page.text('.comment.private .tag')).toEqual(['Private']);
  });

  it('files: the photo as a thumbnail, the logo folded apart, the rest as links; documents', async () => {
    const page = await render();
    expect(
      [...page.element.querySelectorAll('.photo img')].map((i) => i.getAttribute('alt')),
    ).toEqual(['foto.jpg']);
    expect(page.text('.signatures summary')).toEqual(['Signature images (1)']);
    const links = [...page.element.querySelectorAll<HTMLAnchorElement>('a.file')];
    expect(
      links.map((a) => [
        a.querySelector('.name')?.textContent,
        a.querySelector('.size')?.textContent,
        a.getAttribute('href'),
        a.getAttribute('target'),
      ]),
    ).toEqual([
      ['report.xlsx', '20 KB', '/api/tickets/17x1/files/15x3?download=true', null],
      ['log.pdf', '20 KB', '/api/tickets/17x1/files/15x9', '_blank'],
    ]);
  });

  it('"Not a logo" marks the image as a photo', async () => {
    const page = await render();
    [...page.element.querySelectorAll<HTMLButtonElement>('.signatures button')]
      .find((b) => b.textContent?.includes('Not a logo'))!
      .click();
    await page.fixture.whenStable();
    expect(marks).toEqual([['15x1', 'photo']]);
  });

  it('Ask AI opens the panel; "Look at the photos" there, since the ticket has a real photo', async () => {
    const page = await render();
    expect(page.element.querySelector('app-ai-panel')).toBeNull();
    page.element.querySelector<HTMLButtonElement>('.ask-ai')!.click();
    await page.fixture.whenStable();
    expect(page.element.querySelector('app-ai-panel')).not.toBeNull();
    expect(page.text('app-ai-panel .chip')).toContain('Look at the photos');
  });

  it('a ticket the CRM does not give: said, without the rest', async () => {
    ticket = () =>
      throwError(() => ({
        status: 404,
        code: 'not-found',
        title: 'Not Found',
        detail: '',
        fieldErrors: [],
      }));
    const page = await render();
    expect(page.text('.message.error')).toEqual([
      'This ticket does not exist, or your CRM account may not read it.',
    ]);
    expect(page.element.querySelector('.header')).toBeNull();
  });
});
