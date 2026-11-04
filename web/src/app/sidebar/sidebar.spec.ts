import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Sidebar } from './sidebar';

@Component({ template: '' })
class Blank {}

describe('Sidebar', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Blank },
          { path: 'settings', component: Blank },
        ]),
      ],
    });
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

  it("links to every page, below the app's name", async () => {
    const fixture = await sidebarAt('/');
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.app-name')?.textContent?.trim()).toBe('vtiger reader');
    expect(links(element).map(({ icon, label, href }) => ({ icon, label, href }))).toEqual([
      { icon: 'confirmation_number', label: 'Tickets', href: '/' },
      { icon: 'settings', label: 'Settings', href: '/settings' },
    ]);
  });

  it('puts the settings at the bottom, apart from the pages; no sign-out (one profile)', async () => {
    const element = (await sidebarAt('/settings')).nativeElement as HTMLElement;
    const lists = Array.from(element.querySelectorAll('mat-nav-list'));

    expect(
      lists.map((list) =>
        Array.from(list.querySelectorAll('[matListItemTitle]')).map((t) => t.textContent?.trim()),
      ),
    ).toEqual([['Tickets'], ['Settings']]);
    expect(lists[1]!.classList).toContain('bottom');
    expect(links(element).map((l) => l.current)).toEqual([null, 'page']);
  });

  it('highlights the current page; Tickets only on the start page, whatever its filter', async () => {
    const fixture = await sidebarAt('/?status=open');
    expect(links(fixture.nativeElement).map((l) => l.current)).toEqual(['page', null]);

    await TestBed.inject(Router).navigateByUrl('/settings');
    await fixture.whenStable();
    expect(links(fixture.nativeElement).map((l) => l.current)).toEqual([null, 'page']);
    expect(fixture.nativeElement.querySelector('.mdc-list-item--activated')?.textContent).toContain(
      'Settings',
    );
  });

  it('says when a link was tapped, and goes to its page', async () => {
    const fixture = await sidebarAt('/');
    let tapped = 0;
    fixture.componentInstance.navigated.subscribe(() => tapped++);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLAnchorElement>('a[href="/settings"]')!
      .click();
    await fixture.whenStable();

    expect(tapped).toBe(1);
    expect(TestBed.inject(Router).url).toBe('/settings');
  });
});
