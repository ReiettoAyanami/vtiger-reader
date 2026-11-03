import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { AuthApi, type SessionUser } from '../data/auth-api';
import { userGuard } from './user-guard';

@Component({ selector: 'test-page', template: 'page' })
class Page {}

@Component({ selector: 'test-not-found', template: 'not found' })
class NotFound {}

describe('userGuard', () => {
  let getSession: ReturnType<typeof vi.fn>;

  function setUp(user: SessionUser | null) {
    getSession = vi.fn(() => of(user));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Page },
          { path: ':username', canMatch: [userGuard], children: [{ path: '', component: Page }, { path: 'metrics', component: Page }] },
          { path: '**', component: NotFound },
        ]),
        { provide: AuthApi, useValue: { getSession } },
      ],
    });
  }

  async function visit(url: string) {
    const harness = await RouterTestingHarness.create(url);
    return { url: TestBed.inject(Router).url, text: harness.routeNativeElement?.textContent?.trim() };
  }

  it('lets the signed-in user into their own pages, asking the server once', async () => {
    setUp({ id: 1, username: 'lenzi', role: 'user', impersonatedBy: null });

    expect(await visit('/lenzi/metrics')).toEqual({ url: '/lenzi/metrics', text: 'page' });
    await TestBed.inject(Router).navigateByUrl('/lenzi');
    expect(TestBed.inject(Router).url).toBe('/lenzi');
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("another user's pages do not match: the address answers like one that does not exist", async () => {
    setUp({ id: 1, username: 'lenzi', role: 'user', impersonatedBy: null });

    expect(await visit('/other/metrics')).toEqual({ url: '/other/metrics', text: 'not found' });
  });

  it('signed out: the sign-in page, with the address to come back to', async () => {
    setUp(null);

    expect(await visit('/lenzi/metrics?per=week')).toEqual({ url: '/login?next=%2Flenzi%2Fmetrics%3Fper%3Dweek', text: 'page' });
  });
});
