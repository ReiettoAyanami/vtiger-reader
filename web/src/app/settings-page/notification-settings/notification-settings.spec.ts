import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { ListsApi } from '../../data/lists-api';
import { NotificationSettings as Saved } from '../../data/notifications';
import { NotificationsApi } from '../../data/notifications-api';
import { NotificationSettings } from './notification-settings';

const LISTS = [
  { id: 1, name: 'My open tickets', filter: { owner: 'me', status: 'open' } },
  { id: 2, name: 'Unassigned', filter: { owner: 'groups', status: 'open' } },
  { id: 3, name: 'Everything', filter: { owner: 'anyone', status: 'any' } },
];

describe('NotificationSettings', () => {
  async function render(saved: Saved, shown = true) {
    const updates: Array<[boolean, number[]]> = [];
    const snacks: string[] = [];
    let tests = 0;
    TestBed.configureTestingModule({
      imports: [NotificationSettings],
      providers: [
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
        { provide: ListsApi, useValue: { lists: () => of(LISTS) } },
        {
          provide: NotificationsApi,
          useValue: {
            settings: () => of(saved),
            updateSettings: (enabled: boolean, lists: number[]) => {
              updates.push([enabled, lists]);
              return of({ enabled, lists });
            },
            test: () => (tests++, of(shown)),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(NotificationSettings);
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes(label),
      );
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { element, button, updates, snacks, settle, tests: () => tests };
  }

  it('the lists, the notifying ones checked; Save only after a change, with the lists in order', async () => {
    const page = await render({ enabled: true, lists: [2] });
    const boxes = [...page.element.querySelectorAll<HTMLInputElement>('mat-checkbox input')];
    expect(boxes.map((b) => b.checked)).toEqual([false, true, false]);
    expect(page.button('Save')!.disabled).toBe(true);
    boxes[2].click();
    boxes[0].click();
    await page.settle();
    page.button('Save')!.click();
    await page.settle();
    expect(page.updates).toEqual([[true, [1, 2, 3]]]);
  });

  it('turned off: the lists cannot be picked', async () => {
    const page = await render({ enabled: false, lists: [1] });
    const boxes = [...page.element.querySelectorAll<HTMLInputElement>('mat-checkbox input')];
    expect(boxes.every((b) => b.disabled)).toBe(true);
  });

  it('a test on this PC: says whether it was shown', async () => {
    const page = await render({ enabled: true, lists: [1] });
    page.button('Send a test')!.click();
    await page.settle();
    expect(page.tests()).toBe(1);
    expect(page.snacks).toEqual(['Sent: it should be on the screen now']);

    TestBed.resetTestingModule();
    const refused = await render({ enabled: true, lists: [1] }, false);
    refused.button('Send a test')!.click();
    await refused.settle();
    expect(refused.snacks[0]).toContain('Not shown');
  });
});
