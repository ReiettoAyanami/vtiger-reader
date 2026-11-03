import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';

import { ListFilter } from '../../data/lists';
import { ListsApi } from '../../data/lists-api';
import { ListDialog, ListDialogData, filterOf, ownerChoice, statusChoice } from './list-dialog';

describe('the list editor’s choices', () => {
  it('owner and group are one choice, status and value another; empty picks are dropped', () => {
    const filter: ListFilter = {
      owner: 'group',
      group: '20x1',
      status: 'one',
      statusValue: 'In Progress',
      picks: { ticketcategories: 'Hardware' },
    };
    expect(ownerChoice(filter)).toBe('group:20x1');
    expect(statusChoice(filter)).toBe('one:In Progress');
    expect(
      filterOf('group:20x1', 'one:In Progress', {
        ticketcategories: 'Hardware',
        ticketpriorities: '',
      }),
    ).toEqual(filter);
    expect(filterOf('me', 'open', { ticketcategories: '' })).toEqual({
      owner: 'me',
      status: 'open',
    });
  });
});

describe('ListDialog', () => {
  let sent: Array<[string, ListFilter]>;
  let closed: unknown[];

  async function render(data: ListDialogData) {
    sent = [];
    closed = [];
    TestBed.configureTestingModule({
      imports: [ListDialog],
      providers: [
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => closed.push(value) } },
        {
          provide: ListsApi,
          useValue: {
            create: (name: string, filter: ListFilter) => (
              sent.push([name, filter]),
              of({ id: 9, name, filter })
            ),
            update: (id: number, name: string, filter: ListFilter) => (
              sent.push([name, filter]),
              of({ id, name, filter })
            ),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ListDialog);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  const options = {
    statuses: [{ value: 'Open', label: 'Aperto', closed: false }],
    groups: [{ id: '20x1', name: 'Primo livello' }],
    picklists: [
      {
        field: 'ticketcategories',
        label: 'Categoria',
        values: [{ value: 'Hardware', label: 'Hardware' }],
      },
    ],
  };

  it('a new list: mine and open to start with, one choice per picklist of the CRM', async () => {
    const page = await render({ list: null, options });
    expect(page.element.querySelector('h2')?.textContent).toBe('New list');
    expect([...page.element.querySelectorAll('mat-label')].map((l) => l.textContent)).toEqual([
      'Name',
      'Whose tickets',
      'Status',
      'Categoria',
    ]);
  });

  it('needs a name; saves and closes with the list', async () => {
    const page = await render({ list: null, options });
    page.element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await page.fixture.whenStable();
    expect(sent).toEqual([]);
    const name = page.element.querySelector<HTMLInputElement>('input[formControlName="name"]')!;
    name.value = 'Hardware, open';
    name.dispatchEvent(new Event('input'));
    page.element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await page.fixture.whenStable();
    expect(sent).toEqual([['Hardware, open', { owner: 'me', status: 'open' }]]);
    expect(closed).toEqual([
      { id: 9, name: 'Hardware, open', filter: { owner: 'me', status: 'open' } },
    ]);
  });

  it('an existing list: its name and filter, saved over it', async () => {
    const list = {
      id: 4,
      name: 'Group one',
      filter: { owner: 'group' as const, group: '20x1', status: 'any' as const },
    };
    const page = await render({ list, options });
    expect(page.element.querySelector('h2')?.textContent).toBe('Edit the list');
    page.element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await page.fixture.whenStable();
    expect(sent).toEqual([['Group one', { owner: 'group', group: '20x1', status: 'any' }]]);
  });
});
