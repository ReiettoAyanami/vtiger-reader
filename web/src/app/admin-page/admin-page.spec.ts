import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { AdminApi } from '../data/admin-api';
import { AuthApi, type SessionUser } from '../data/auth-api';
import { User } from '../data/user';
import { DeleteUserDialog } from '../delete-user-dialog/delete-user-dialog';
import { EntityDialog } from '../entity-dialog/entity-dialog';
import { HistoryDialogs } from '../history-dialogs';
import { Session } from '../session/session';
import { UserCard } from '../ui/user-card/user-card';
import { AdminPage } from './admin-page';

@Component({ template: '' })
class Blank {}

const lenzi: User = { id: 1, username: 'lenzi', email: 'lenzi@dev.invalid', role: 'admin', blocked: false, hasPassword: true, createdAt: '2026-10-03T09:00:00Z' };
const friend: User = { id: 7, username: 'friend', email: 'friend@dev.invalid', role: 'user', blocked: false, hasPassword: true, createdAt: '2026-10-03T10:00:00Z' };

describe('AdminPage', () => {
  let session: SessionUser | null;
  let listed: number;
  let opened: Array<{ component: unknown; data: unknown }>;
  let dialogResult: unknown;
  let impersonate: (id: number) => Observable<void>;
  let snacks: string[];

  async function render() {
    TestBed.configureTestingModule({
      imports: [AdminPage],
      providers: [
        provideRouter([
          { path: 'lenzi/admin', component: Blank },
          { path: 'friend', component: Blank },
        ]),
        { provide: AuthApi, useValue: { getSession: () => of(session) } },
        {
          provide: AdminApi,
          useValue: {
            listUsers: () => (listed++, of([friend, lenzi])),
            impersonate: (id: number) => impersonate(id),
          },
        },
        {
          provide: HistoryDialogs,
          useValue: { open: async (component: unknown, data: unknown) => (opened.push({ component, data }), dialogResult) },
        },
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    });
    await TestBed.inject(Session).load();
    await TestBed.inject(Router).navigateByUrl('/lenzi/admin');
    const fixture = TestBed.createComponent(AdminPage);
    await fixture.whenStable();
    const cards = () => fixture.debugElement.queryAll(By.directive(UserCard)).map((d) => d.componentInstance as UserCard);
    return { fixture, element: fixture.nativeElement as HTMLElement, cards, settle: () => fixture.whenStable() };
  }

  beforeEach(() => {
    session = { id: 1, username: 'lenzi', role: 'admin', impersonatedBy: null };
    listed = 0;
    opened = [];
    dialogResult = undefined;
    snacks = [];
    impersonate = () => of(undefined);
  });

  it('one card per user; the administrator’s own card has no actions', async () => {
    const page = await render();
    expect(Array.from(page.element.querySelectorAll('app-user-card .username')).map((u) => u.textContent?.trim())).toEqual(['friend', 'lenzi']);
    const own = page.element.querySelectorAll('app-user-card')[1]!;
    expect(own.querySelector('button.more')).toBeNull();
    expect(own.querySelector('.you')).not.toBeNull();
    expect(page.element.querySelector('app-add-button')).not.toBeNull();
  });

  it('the "+" opens the user form in the entity dialog; a created user brings the list again', async () => {
    const page = await render();
    dialogResult = { kind: 'user', user: friend };
    page.element.querySelector<HTMLButtonElement>('app-add-button button')!.click();
    await page.settle();
    await vi.waitFor(() => expect(listed).toBe(2));
    expect(opened).toEqual([{ component: EntityDialog, data: { kinds: ['user'] } }]);
  });

  it('edit opens the form filled in; delete asks with its dialog; both bring the list again', async () => {
    const page = await render();
    dialogResult = { kind: 'user', user: friend };
    page.cards()[0]!.edit.emit();
    await vi.waitFor(() => expect(listed).toBe(2));
    dialogResult = true;
    page.cards()[0]!.remove.emit();
    await vi.waitFor(() => expect(listed).toBe(3));

    expect(opened).toEqual([
      { component: EntityDialog, data: { kinds: ['user'], edit: { kind: 'user', user: friend } } },
      { component: DeleteUserDialog, data: friend },
    ]);
  });

  it('a cancelled dialog changes nothing', async () => {
    const page = await render();
    page.cards()[0]!.edit.emit();
    await page.settle();
    await new Promise((resolve) => setTimeout(resolve));
    expect(listed).toBe(1);
  });

  it("impersonate: this browser becomes the user's, on their start page", async () => {
    const page = await render();
    impersonate = (id) => {
      expect(id).toBe(7);
      session = { id: 7, username: 'friend', role: 'user', impersonatedBy: 1 };
      return of(undefined);
    };
    page.cards()[0]!.impersonate.emit();

    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/friend'));
    expect(TestBed.inject(Session).user()).toEqual({ id: 7, username: 'friend', role: 'user', impersonatedBy: 1 });
  });

  it('a list that cannot be loaded says why', async () => {
    TestBed.overrideProvider(AdminApi, {
      useValue: { listUsers: () => throwError(() => ({ status: 500, code: null, title: 'Internal Server Error', detail: '', fieldErrors: [] })) },
    });
    const page = await render();
    expect(page.element.querySelector('.error')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Could not load the users: Internal Server Error (500)');
  });

  it('an impersonation refused says why and stays here', async () => {
    const page = await render();
    impersonate = () => throwError(() => ({ status: 409, code: 'user-blocked', title: 'Conflict', detail: 'A blocked user cannot be impersonated: unblock it first', fieldErrors: [] }));
    page.cards()[0]!.impersonate.emit();

    await vi.waitFor(() => expect(snacks).toEqual(['Could not impersonate friend: A blocked user cannot be impersonated: unblock it first']));
    expect(TestBed.inject(Router).url).toBe('/lenzi/admin');
  });
});
