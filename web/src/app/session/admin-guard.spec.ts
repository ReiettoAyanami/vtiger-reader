import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { AuthApi, type SessionUser } from '../data/auth-api';
import { adminGuard } from './admin-guard';
import { userGuard } from './user-guard';

@Component({ selector: 'test-admin', template: 'admin' })
class Admin {}

@Component({ selector: 'test-other', template: 'other' })
class Other {}

describe('adminGuard', () => {
  /** The admin view where the app has it (design-accounts.md, "Web: /<username>/admin"): under the user's own pages. */
  async function visit(url: string, user: SessionUser | null) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Other },
          {
            path: ':username',
            canMatch: [userGuard],
            children: [
              { path: 'admin', canMatch: [adminGuard], component: Admin },
              { path: '**', component: Other },
            ],
          },
          { path: '**', component: Other },
        ]),
        { provide: AuthApi, useValue: { getSession: () => of(user) } },
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    return { url: TestBed.inject(Router).url, text: harness.routeNativeElement?.textContent?.trim() };
  }

  it('an administrator acting as itself: the admin view, under its own username', async () => {
    expect(await visit('/lenzi/admin', { id: 1, username: 'lenzi', role: 'admin', impersonatedBy: null })).toEqual({ url: '/lenzi/admin', text: 'admin' });
  });

  it('a user: no match, like an address that does not exist', async () => {
    expect(await visit('/friend/admin', { id: 2, username: 'friend', role: 'user', impersonatedBy: null })).toEqual({ url: '/friend/admin', text: 'other' });
  });

  it('during an impersonation, even of an administrator: no match', async () => {
    expect(await visit('/chief/admin', { id: 3, username: 'chief', role: 'admin', impersonatedBy: 1 })).toEqual({ url: '/chief/admin', text: 'other' });
  });

  it('a user called admin (lenzi, 2026-10-03: the default first administrator): /admin/admin', async () => {
    expect(await visit('/admin/admin', { id: 1, username: 'admin', role: 'admin', impersonatedBy: null })).toEqual({ url: '/admin/admin', text: 'admin' });
  });

  it('signed out: the sign-in page first, coming back here', async () => {
    expect((await visit('/lenzi/admin', null)).url).toBe('/login?next=%2Flenzi%2Fadmin');
  });
});
