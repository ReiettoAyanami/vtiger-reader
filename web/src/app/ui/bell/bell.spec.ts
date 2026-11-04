import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { Bell as BellData } from '../../data/notifications';
import { NotificationsApi } from '../../data/notifications-api';
import { TicketRow } from '../../data/tickets';
import { LiveNotifications } from '../../notifications/live-notifications';
import { Session } from '../../session/session';
import { UserTimeZone } from '../when';
import { Bell } from './bell';

function ticket(id: string, number: string, title: string, createdAt: string): TicketRow {
  return {
    id,
    number,
    title,
    status: 'Open',
    statusIndex: 0,
    priority: 'High',
    category: '',
    createdAt,
    modifiedAt: createdAt,
    owner: { kind: 'nobody' },
    organization: null,
    contact: null,
    closed: false,
  };
}

describe('Bell', () => {
  async function render(answers: BellData[]) {
    const arrivals = signal(0);
    const seen: string[] = [];
    let call = 0;
    TestBed.configureTestingModule({
      imports: [Bell],
      providers: [
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: LiveNotifications, useValue: { arrivals } },
        { provide: UserTimeZone, useValue: { zone: () => 'UTC', load: async () => 'UTC' } },
        {
          provide: Session,
          useValue: {
            user: () => ({ username: 'lenzi' }),
            path: (page = '') => `/lenzi${page}`,
          },
        },
        {
          provide: NotificationsApi,
          useValue: {
            bell: () => of(answers[Math.min(call++, answers.length - 1)]),
            seen: (upTo: string) => (seen.push(upTo), of(undefined)),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(Bell);
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, element, arrivals, seen };
  }

  const two = [
    ticket('17x2', 'TT2', 'Printer on fire', '2026-11-04T10:05:00Z'),
    ticket('17x1', 'TT1', 'Mail down', '2026-11-04T09:00:00Z'),
  ];

  it('notifications off: no bell', async () => {
    const page = await render([{ enabled: false, items: [] }]);
    expect(page.element.querySelector('button')).toBeNull();
  });

  it('the count on the bell; opening lists them and marks them seen up to the newest', async () => {
    const page = await render([
      { enabled: true, items: two },
      { enabled: true, items: [] },
    ]);
    const button = page.element.querySelector<HTMLButtonElement>('button.bell')!;
    expect(button.getAttribute('aria-label')).toBe('2 new tickets');
    button.click();
    await page.fixture.whenStable();
    page.fixture.detectChanges();
    const rows = [...document.querySelectorAll<HTMLAnchorElement>('.mat-mdc-menu-panel a.item')];
    expect(rows.map((r) => r.querySelector('.ticket-title')?.textContent?.trim())).toEqual([
      'Printer on fire',
      'Mail down',
    ]);
    expect(rows[0].getAttribute('href')).toBe('/lenzi/tickets/17x2');
    expect(page.seen).toEqual(['2026-11-04T10:05:00Z']);
    // Read again after "seen": nothing new.
    page.fixture.detectChanges();
    await page.fixture.whenStable();
    expect(button.getAttribute('aria-label')).toBe('No new tickets');
  });

  it('a live event: the bell is read again', async () => {
    const page = await render([
      { enabled: true, items: [] },
      { enabled: true, items: two },
    ]);
    const button = () => page.element.querySelector<HTMLButtonElement>('button.bell')!;
    expect(button().getAttribute('aria-label')).toBe('No new tickets');
    page.arrivals.set(1);
    await page.fixture.whenStable();
    page.fixture.detectChanges();
    expect(button().getAttribute('aria-label')).toBe('2 new tickets');
  });
});
