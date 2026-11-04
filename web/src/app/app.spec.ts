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
import { CrmLinkApi } from './data/crm-link-api';
import { SettingsApi } from './data/settings-api';
import { TicketsApi } from './data/tickets-api';
import { AiApi } from './data/ai-api';
import { ListsApi } from './data/lists-api';
import { NotificationsApi } from './data/notifications-api';
import { VersionApi } from './data/version-api';

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
    // the settings' AI section
    {
      provide: AiApi,
      useValue: {
        providers: () => of([]),
        tasks: () =>
          of({
            default: null,
            summary: null,
            reply: null,
            photos: null,
            history: null,
            question: null,
          }),
        usage: () => of([]),
      },
    },
    // the start page: the tickets, through the user's lists
    { provide: ListsApi, useValue: { lists: () => of([]), counts: () => of({}) } },
    {
      provide: TicketsApi,
      useValue: {
        options: () => of({ statuses: [], groups: [], picklists: [] }),
        list: () => of({ items: [], page: 0, size: 50, total: 0 }),
        names: () => of({}),
        customers: () => of([]),
      },
    },
    // the shell's own: the version in the corner
    { provide: VersionApi, useValue: { getVersion: () => of('dev26.0.0') } },
    // the bell in the top bar
    {
      provide: NotificationsApi,
      useValue: {
        bell: () => of({ enabled: true, items: [] }),
        settings: () => of({ enabled: true, lists: [], devices: 0 }),
      },
    },
  ];
}

describe('App', () => {
  /** The app at `url`. */
  async function start(url = '/') {
    const getSettings = vi.fn(() => of({ language: 'en', timezone: 'Europe/Rome' }));
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        // jsdom has no animation events: the drawer opens and closes at once
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
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

  it('opens on the tickets, with its title in the top bar', async () => {
    const app = await start();

    expect(app.router.url).toBe('/');
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

  it('shows the pages at the root; an unknown page or an old address gets the 404 page', async () => {
    const app = await start('/settings');
    expect(app.title()).toBe('Settings');
    expect(app.element.querySelector('app-settings-page')).not.toBeNull();
    expect(app.getSettings).toHaveBeenCalledTimes(1);

    // the old addresses, under a username, and the admin view are gone (plan 7.1)
    for (const url of ['/no-such-page', '/tickets', '/lenzi', '/lenzi/settings', '/lenzi/admin', '/login']) {
      await app.go(url);
      expect(app.router.url).toBe(url);
      expect(app.element.querySelector('app-not-found-page')).not.toBeNull();
      expect(app.title()).toBe('Not found');
      // the way out: the tickets
      expect(app.element.querySelector('app-not-found-page a')?.getAttribute('href')).toBe('/');
    }
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
    expect(app.router.url).toBe('/settings');
    expect(app.title()).toBe('Settings');
    expect(app.sidebar.opened).toBe(false);
  });

  it("opened, the drawer puts the focus on the current page's entry, never on the first one (it would look selected)", async () => {
    const app = await start('/settings');
    app.menuButton()!.click();
    await app.fixture.whenStable();
    // The drawer moves the focus once it is open: wait for the entry itself, the current page's.
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-current')).toBe('page'),
    );
    expect(document.activeElement?.textContent).toContain('Settings');
  });
});
