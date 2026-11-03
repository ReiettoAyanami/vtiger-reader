import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSidenav } from '@angular/material/sidenav';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { App } from './app';
import { routes } from './app.routes';
import { AdminApi } from './data/admin-api';
import { AuthApi, type SessionUser } from './data/auth-api';
import { CrmLinkApi } from './data/crm-link-api';
import { SettingsApi } from './data/settings-api';
import { TicketsApi } from './data/tickets-api';
import { VersionApi } from './data/version-api';

const lenzi: SessionUser = { id: 1, username: 'lenzi', role: 'admin', impersonatedBy: null };

/** The pages' data: the shell is tested here, not what the pages show. */
function pageData(getSettings: () => unknown) {
  return [
    { provide: SettingsApi, useValue: { getSettings } },
    {
      provide: CrmLinkApi,
      useValue: {
        getLink: () =>
          of({
            crmUrl: null,
            linked: false,
            username: null,
            linkedAt: null,
            lastLoginAt: null,
            problem: null,
          }),
      },
    },
    // the start page: the tickets
    {
      provide: TicketsApi,
      useValue: {
        folders: () => of({ folders: [], statuses: [] }),
        folderCounts: () => of({}),
        list: () => of({ items: [], page: 0, size: 50, total: 0 }),
        names: () => of({}),
        customers: () => of([]),
      },
    },
    // the shell's own: the version in the corner
    { provide: VersionApi, useValue: { getVersion: () => of('dev26.0.0') } },
    // the admin view
    { provide: AdminApi, useValue: { listUsers: () => of([]) } },
  ];
}

describe('App', () => {
  /** The app at `url`, with `user` signed in (null: nobody). */
  async function start(url = '/', user: SessionUser | null = lenzi) {
    let session = user;
    const getSettings = vi.fn(() => of({ language: 'en', timezone: 'Europe/Rome' }));
    const signOut = vi.fn(() => {
      session = null;
      return of(undefined);
    });
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        // jsdom has no animation events: the drawer opens and closes at once
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AuthApi, useValue: { getSession: () => of(session), signOut } },
        ...pageData(getSettings),
      ],
    });
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      element,
      router,
      getSettings,
      signOut,
      go: async (to: string) => {
        await router.navigateByUrl(to);
        await fixture.whenStable();
      },
      sidebar: fixture.debugElement.query(By.directive(MatSidenav)).componentInstance as MatSidenav,
      title: () => element.querySelector('mat-toolbar .title')?.textContent?.trim(),
      menuButton: () =>
        element.querySelector<HTMLButtonElement>('mat-toolbar button[aria-label="Menu"]'),
      link: (label: string) =>
        Array.from(element.querySelectorAll<HTMLElement>('app-sidebar [mat-list-item]')).find((a) =>
          a.textContent?.includes(label),
        )!,
    };
  }

  it("opens on the signed-in user's tickets, under their username, with its title in the top bar", async () => {
    const app = await start();

    expect(app.router.url).toBe('/lenzi');
    expect(app.title()).toBe('Tickets');
    expect(app.element.querySelector('app-tickets-page')).not.toBeNull();
    // the instance's version, in the corner
    app.fixture.detectChanges();
    expect(app.element.querySelector('app-version-label')?.textContent?.trim()).toBe('dev26.0.0');
  });

  it('starts with the transparency this browser chose: reduced, the windows are solid from the first page', async () => {
    localStorage.setItem('vtiger-reader.reduce-transparency', 'true');
    document.documentElement.classList.remove('reduce-transparency');
    await start();

    expect(document.documentElement.classList.contains('reduce-transparency')).toBe(true);
    localStorage.removeItem('vtiger-reader.reduce-transparency');
    document.documentElement.classList.remove('reduce-transparency');
  });

  it('shows the pages under the username; an unknown page, an old address, another user all get the same 404', async () => {
    const app = await start('/lenzi/settings');
    expect(app.title()).toBe('Settings');
    expect(app.element.querySelector('app-settings-page')).not.toBeNull();
    // the page is made once: hiding or showing the app around it does not make it again
    expect(app.getSettings).toHaveBeenCalledTimes(1);

    for (const url of [
      '/lenzi/no-such-page',
      '/tickets',
      '/settings',
      '/other-user',
      '/other-user/settings',
    ]) {
      await app.go(url);
      expect(app.router.url).toBe(url);
      expect(app.element.querySelector('app-not-found-page')).not.toBeNull();
      expect(app.title()).toBe('Not found');
      // the way out: one's own start page
      expect(app.element.querySelector('app-not-found-page a')?.getAttribute('href')).toBe(
        '/lenzi',
      );
    }
  });

  it('signed out, a page asks to sign in first and keeps the address; the sign-in page stands alone', async () => {
    const app = await start('/lenzi/settings', null);

    expect(app.router.url).toBe('/login?next=%2Flenzi%2Fsettings');
    expect(app.element.querySelector('app-login-page')).not.toBeNull();
    expect(app.element.querySelector('mat-toolbar')).toBeNull();
    expect(app.element.querySelector('app-sidebar')).toBeNull();

    // whatever the username: nothing tells whether it exists
    await app.go('/other-user');
    expect(app.router.url).toBe('/login?next=%2Fother-user');
    await app.go('/');
    expect(app.router.url).toBe('/login');
  });

  it('signed in, the sign-in page sends the user to their own pages', async () => {
    const app = await start('/login');
    expect(app.router.url).toBe('/lenzi');
  });

  it('the sidebar is a drawer on every screen, as on a phone: opened from the top bar, closed after a tap on a link', async () => {
    const app = await start();
    expect(app.sidebar.mode).toBe('over');
    expect(app.sidebar.opened).toBe(false);

    app.menuButton()!.click();
    await app.fixture.whenStable();
    expect(app.sidebar.opened).toBe(true);

    app.link('Settings').click();
    await app.fixture.whenStable();
    expect(app.router.url).toBe('/lenzi/settings');
    expect(app.title()).toBe('Settings');
    expect(app.sidebar.opened).toBe(false);
  });

  it("opened, the drawer puts the focus on the current page's entry, never on the first one (it would look selected)", async () => {
    const app = await start('/lenzi/settings');
    app.menuButton()!.click();
    await app.fixture.whenStable();
    // The drawer moves the focus once it is open: wait for the entry itself, the current page's.
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-current')).toBe('page'),
    );
    expect(document.activeElement?.textContent).toContain('Settings');
  });

  it('/<username>/admin: the admin view in the app for an administrator; for a user, the 404 page', async () => {
    const app = await start('/lenzi/admin');
    expect(app.router.url).toBe('/lenzi/admin');
    expect(app.title()).toBe('Admin');
    expect(app.element.querySelector('app-admin-page')).not.toBeNull();
    // /admin is no page of its own any more: the start page of a user called admin, not lenzi's
    await app.go('/admin');
    expect(app.element.querySelector('app-admin-page')).toBeNull();
    expect(app.element.querySelector('app-not-found-page')).not.toBeNull();
    TestBed.resetTestingModule();

    const user = await start('/friend/admin', {
      id: 2,
      username: 'friend',
      role: 'user',
      impersonatedBy: null,
    });
    expect(user.router.url).toBe('/friend/admin');
    expect(user.element.querySelector('app-not-found-page')).not.toBeNull();
  });

  it('"admin" is a username like any other (lenzi, 2026-10-03): /admin is its start page, /admin/admin its admin view', async () => {
    const app = await start('/admin', {
      id: 1,
      username: 'admin',
      role: 'admin',
      impersonatedBy: null,
    });
    expect(app.element.querySelector('app-tickets-page')).not.toBeNull();

    await app.go('/admin/admin');
    expect(app.element.querySelector('app-admin-page')).not.toBeNull();
  });

  it('an administrator acting as a user: the "Viewing as" bar above the top bar, no admin view', async () => {
    const app = await start('/friend', {
      id: 7,
      username: 'friend',
      role: 'user',
      impersonatedBy: 1,
    });

    expect(app.element.querySelector('app-viewing-as-bar')?.textContent).toContain(
      'Viewing as friend',
    );
    const bar = app.element.querySelector('app-viewing-as-bar')!;
    expect(
      bar.compareDocumentPosition(app.element.querySelector('mat-toolbar')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await app.go('/friend/admin');
    expect(app.element.querySelector('app-not-found-page')).not.toBeNull();
  });

  it('nobody impersonated: no bar', async () => {
    const app = await start();
    expect(app.element.querySelector('app-viewing-as-bar')).toBeNull();
  });

  it('signs out from the sidebar, after confirming: the session ends and the sign-in page stands alone', async () => {
    const app = await start('/lenzi/settings');
    app.menuButton()!.click();
    await app.fixture.whenStable();

    app.link('Sign out').click();
    await app.fixture.whenStable();
    // the confirmation first: nothing has happened yet
    const dialog = document.querySelector('.cdk-overlay-container app-confirm-dialog');
    expect(dialog?.querySelector('h2')?.textContent?.trim()).toBe('Sign out?');
    expect(app.signOut).not.toHaveBeenCalled();

    dialog!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await vi.waitFor(() => expect(app.router.url).toBe('/login'));
    await app.fixture.whenStable();

    expect(app.signOut).toHaveBeenCalledTimes(1);
    expect(app.router.url).toBe('/login');
    expect(app.sidebar.opened).toBe(false);
    expect(app.element.querySelector('app-login-page')).not.toBeNull();
    expect(app.element.querySelector('mat-toolbar')).toBeNull();
  });
});
