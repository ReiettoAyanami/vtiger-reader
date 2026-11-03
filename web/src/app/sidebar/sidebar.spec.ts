import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { ConfirmDialog, type ConfirmDialogData } from '../confirm-dialog/confirm-dialog';
import { AuthApi } from '../data/auth-api';
import { HistoryDialogs } from '../history-dialogs';
import { Session } from '../session/session';
import { Sidebar } from './sidebar';

@Component({ template: '' })
class Blank {}

describe('Sidebar', () => {
  let signOut: ReturnType<typeof vi.fn>;
  /** The confirmation dialogs opened, and what the user answers in them (true: confirm). */
  let asked: Array<{ component: unknown; data: ConfirmDialogData; config: unknown }>;
  let answer: boolean;

  beforeEach(async () => {
    signOut = vi.fn(() => of(undefined));
    asked = [];
    answer = true;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Blank },
          {
            path: 'lenzi',
            children: [
              { path: '', component: Blank },
              { path: 'settings', component: Blank },
            ],
          },
        ]),
        {
          provide: AuthApi,
          useValue: { getSession: () => of({ id: 1, username: 'lenzi', role: 'user', impersonatedBy: null }), signOut },
        },
        // The confirm dialog as the user uses it: Cancel closes it with nothing; confirming runs its
        // action and closes it with true, or stays open (closed later with nothing) when it fails.
        {
          provide: HistoryDialogs,
          useValue: {
            open: async (component: unknown, data: ConfirmDialogData, config: unknown) => {
              asked.push({ component, data, config });
              if (!answer) return undefined;
              try {
                await firstValueFrom(data.action());
                return true;
              } catch {
                return undefined;
              }
            },
          },
        },
      ],
    });
    await TestBed.inject(Session).load();
  });

  /** The sidebar, after the router went to `url`. */
  async function sidebarAt(url: string) {
    await RouterTestingHarness.create(url);
    const fixture = TestBed.createComponent(Sidebar);
    await fixture.whenStable();
    return fixture;
  }

  const links = (element: HTMLElement) =>
    Array.from(element.querySelectorAll<HTMLAnchorElement>('a[mat-list-item]')).map((a) => ({
      icon: a.querySelector('mat-icon')?.textContent?.trim(),
      label: a.querySelector('[matListItemTitle]')?.textContent?.trim(),
      href: a.getAttribute('href'),
      current: a.getAttribute('aria-current'),
    }));

  it("links to every page of the user, under their username, below the app's name and the username", async () => {
    const fixture = await sidebarAt('/lenzi');
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.app-name')?.textContent?.trim()).toBe('vtiger reader');
    expect(element.querySelector('.username')?.textContent?.trim()).toBe('lenzi');
    expect(links(element).map(({ icon, label, href }) => ({ icon, label, href }))).toEqual([
      { icon: 'confirmation_number', label: 'Tickets', href: '/lenzi' },
      { icon: 'settings', label: 'Settings', href: '/lenzi/settings' },
    ]);
  });

  it('puts "Sign out" and the settings at the bottom, apart from the pages', async () => {
    const element = (await sidebarAt('/lenzi/settings')).nativeElement as HTMLElement;
    const lists = Array.from(element.querySelectorAll('mat-nav-list'));

    expect(lists.map((list) => Array.from(list.querySelectorAll('[matListItemTitle]')).map((t) => t.textContent?.trim()))).toEqual([
      ['Tickets'],
      ['Sign out', 'Settings'],
    ]);
    expect(lists[1]!.classList).toContain('bottom');
    expect(links(element).map((l) => l.current)).toEqual([null, 'page']);
  });

  it('highlights the current page; Tickets only on the start page, whatever its filter', async () => {
    const fixture = await sidebarAt('/lenzi?status=open');
    expect(links(fixture.nativeElement).map((l) => l.current)).toEqual(['page', null]);

    await TestBed.inject(Router).navigateByUrl('/lenzi/settings');
    await fixture.whenStable();
    expect(links(fixture.nativeElement).map((l) => l.current)).toEqual([null, 'page']);
    expect(fixture.nativeElement.querySelector('.mdc-list-item--activated')?.textContent).toContain('Settings');
  });

  it('says when a link was tapped, and goes to its page', async () => {
    const fixture = await sidebarAt('/lenzi');
    let tapped = 0;
    fixture.componentInstance.navigated.subscribe(() => tapped++);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a[href="/lenzi/settings"]')!.click();
    await fixture.whenStable();

    expect(tapped).toBe(1);
    expect(TestBed.inject(Router).url).toBe('/lenzi/settings');
  });

  it('signs out after asking: the session ends, the drawer closes, the sign-in page opens', async () => {
    const fixture = await sidebarAt('/lenzi/settings');
    let tapped = 0;
    fixture.componentInstance.navigated.subscribe(() => tapped++);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.sign-out')!.click();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/login'));

    expect(asked.map((a) => [a.component, a.data.title, a.data.confirm, a.data.destructive])).toEqual([
      [ConfirmDialog, 'Sign out?', 'Sign out', false],
    ]);
    expect(tapped).toBe(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(Session).user()).toBeNull();
  });

  it('a sign-out cancelled in the dialog: nothing happens, and the focus is not left on "Sign out"', async () => {
    answer = false;
    const fixture = await sidebarAt('/lenzi/settings');
    let tapped = 0;
    fixture.componentInstance.navigated.subscribe(() => tapped++);
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.sign-out')!;

    button.focus();
    button.click();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await fixture.whenStable();

    expect(signOut).not.toHaveBeenCalled();
    expect(tapped).toBe(0);
    expect(TestBed.inject(Router).url).toBe('/lenzi/settings');
    expect(TestBed.inject(Session).user()?.username).toBe('lenzi');
    // a focused entry is drawn highlighted: the focus goes to the current page's, never back to Sign out
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('aria-current')).toBe('page'));
    expect(document.activeElement?.textContent).toContain('Settings');
    expect(asked[0]!.config).toMatchObject({ restoreFocus: false });
  });

  it('an administrator acting as itself also finds "Admin", above "Sign out"', async () => {
    const auth = TestBed.inject(AuthApi) as unknown as { getSession: () => unknown };
    auth.getSession = () => of({ id: 1, username: 'lenzi', role: 'admin', impersonatedBy: null });
    await TestBed.inject(Session).reload();
    const fixture = await sidebarAt('/lenzi');
    const element = fixture.nativeElement as HTMLElement;
    const bottomTitles = () =>
      Array.from(element.querySelectorAll('mat-nav-list')[1]!.querySelectorAll('[matListItemTitle]')).map((t) => t.textContent?.trim());

    expect(bottomTitles()).toEqual(['Admin', 'Sign out', 'Settings']);
    expect(element.querySelectorAll('mat-nav-list')[1]!.querySelector('a')?.getAttribute('href')).toBe('/lenzi/admin');

    // while impersonating, never: the admin view is not for the user being viewed
    auth.getSession = () => of({ id: 1, username: 'lenzi', role: 'admin', impersonatedBy: 3 });
    await TestBed.inject(Session).reload();
    await fixture.whenStable();
    expect(bottomTitles()).toEqual(['Sign out', 'Settings']);
  });

  it('a sign-out the server did not take (the dialog says why): still signed in, still here', async () => {
    signOut.mockReturnValue(throwError(() => ({ status: null })));
    const fixture = await sidebarAt('/lenzi/settings');
    let tapped = 0;
    fixture.componentInstance.navigated.subscribe(() => tapped++);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.sign-out')!.click();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await fixture.whenStable();

    expect(tapped).toBe(0);
    expect(TestBed.inject(Router).url).toBe('/lenzi/settings');
    expect(TestBed.inject(Session).user()?.username).toBe('lenzi');
  });
});
