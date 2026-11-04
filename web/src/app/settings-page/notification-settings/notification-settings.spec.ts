import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { ListsApi } from '../../data/lists-api';
import { NotificationSettings as Saved } from '../../data/notifications';
import { NotificationsApi } from '../../data/notifications-api';
import { PushState, PushSubscriptions } from '../../notifications/push-subscriptions';
import { NotificationSettings } from './notification-settings';

const LISTS = [
  { id: 1, name: 'My open tickets', filter: { owner: 'me', status: 'open' } },
  { id: 2, name: 'Unassigned', filter: { owner: 'groups', status: 'open' } },
  { id: 3, name: 'Everything', filter: { owner: 'anyone', status: 'any' } },
];

describe('NotificationSettings', () => {
  async function render(saved: Saved, pushState: PushState = 'off') {
    const updates: Array<[boolean, number[]]> = [];
    const state = signal<PushState>(pushState);
    const push = {
      state,
      refresh: vi.fn(async () => state()),
      enable: vi.fn(async () => (state.set('on'), 'on' as PushState)),
      disable: vi.fn(async () => (state.set('off'), 'off' as PushState)),
    };
    const sent: number[] = [];
    TestBed.configureTestingModule({
      imports: [NotificationSettings],
      providers: [
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
        { provide: PushSubscriptions, useValue: push },
        { provide: ListsApi, useValue: { lists: () => of(LISTS) } },
        {
          provide: NotificationsApi,
          useValue: {
            settings: () => of(saved),
            updateSettings: (enabled: boolean, lists: number[]) => {
              updates.push([enabled, lists]);
              return of({ enabled, lists, devices: saved.devices });
            },
            test: () => (sent.push(1), of(1)),
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
    return { fixture, element, button, updates, push, sent, settle };
  }

  it('the lists, the notifying ones checked; Save only after a change, with the lists in order', async () => {
    const page = await render({ enabled: true, lists: [2], devices: 0 });
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

  it('turned off: the lists cannot be picked, push cannot be turned on', async () => {
    const page = await render({ enabled: false, lists: [1], devices: 0 });
    const boxes = [...page.element.querySelectorAll<HTMLInputElement>('mat-checkbox input')];
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect(page.button('Turn on here')!.disabled).toBe(true);
  });

  it('this browser: on, then a test, then off', async () => {
    const page = await render({ enabled: true, lists: [1], devices: 0 });
    expect(page.push.refresh).toHaveBeenCalled();
    page.button('Turn on here')!.click();
    await page.settle();
    expect(page.push.enable).toHaveBeenCalled();
    page.button('Send a test')!.click();
    await page.settle();
    expect(page.sent).toEqual([1]);
    page.button('Turn off here')!.click();
    await page.settle();
    expect(page.push.disable).toHaveBeenCalled();
    expect(page.button('Turn on here')).toBeTruthy();
  });

  it('blocked by the browser: says where to allow them, no button', async () => {
    const page = await render({ enabled: true, lists: [1], devices: 1 }, 'blocked');
    expect(page.element.textContent).toContain('blocked for this site');
    expect(page.button('Turn on here')).toBeUndefined();
    expect(page.element.textContent).toContain('1 browser gets your notifications');
  });
});
